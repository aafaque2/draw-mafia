const RoomManager = require('./RoomManager');
const GameEngine = require('./GameEngine');
const { LIMITS, RATE_LIMIT } = require('./constants');

/**
 * Send a structured error to a socket and log it.
 * @param {import('socket.io').Socket} socket
 * @param {string} code
 * @param {string} message
 */
function emitError(socket, code, message) {
  console.warn('[error] ' + code + ': ' + message + ' (socket ' + socket.id + ')');
  socket.emit('error', { code, message });
}

/**
 * Wrap a socket event handler with try/catch.
 * @param {import('socket.io').Socket} socket
 * @param {string} eventName
 * @param {Function} handler
 */
function wrapHandler(socket, eventName, handler) {
  return (...args) => {
    try {
      handler(...args);
    } catch (err) {
      console.error('[' + eventName + ']', err);
      socket.emit('error', { code: 'INTERNAL', message: 'An internal error occurred' });
    }
  };
}

/**
 * Strip HTML tags, trim, and truncate.
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
function sanitizeString(str, maxLength) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim().slice(0, maxLength || LIMITS.CHAT_MESSAGE_MAX);
}

// --- Rate Limiter (sliding-window per socket) ---

const rateLimitStores = [];

function makeRateLimiter(windowMs, maxHits) {
  const store = new Map();
  rateLimitStores.push(store);
  return function isLimited(socketId) {
    const now = Date.now();
    let timestamps = store.get(socketId);
    if (!timestamps) {
      timestamps = [];
      store.set(socketId, timestamps);
    }
    while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
      timestamps.shift();
    }
    if (timestamps.length >= maxHits) return true;
    timestamps.push(now);
    return false;
  };
}

const isChatRateLimited = makeRateLimiter(RATE_LIMIT.CHAT_WINDOW_MS, RATE_LIMIT.CHAT_MAX);
const isDrawRateLimited = makeRateLimiter(RATE_LIMIT.DRAW_WINDOW_MS, RATE_LIMIT.DRAW_MAX);
const isVoteRateLimited = makeRateLimiter(RATE_LIMIT.VOTE_WINDOW_MS, RATE_LIMIT.VOTE_MAX);
const isCreateRateLimited = makeRateLimiter(RATE_LIMIT.CREATE_ROOM_WINDOW_MS, RATE_LIMIT.CREATE_ROOM_MAX);

function clearRateLimitData(socketId) {
  rateLimitStores.forEach((store) => store.delete(socketId));
}

// --- Socket Setup ---

/**
 * Attach all Socket.IO event handlers to the given server instance.
 * @param {import('socket.io').Server} io
 */
function setupSocket(io) {
  io.on('connection', (socket) => {

    // ---- create-room ----
    socket.on('create-room', (data) => {
      try {
        if (isCreateRateLimited(socket.id)) {
          emitError(socket, 'RATE_LIMIT', 'Too many rooms created. Wait a moment.');
          return;
        }

        const playerName = sanitizeString(data && data.playerName, LIMITS.PLAYER_NAME_MAX);
        if (!playerName) {
          emitError(socket, 'VALIDATION', 'Player name is required');
          return;
        }

        const { roomCode, playerId, reconnectToken, room } = RoomManager.createRoom(socket.id, playerName);

        socket.join(roomCode);
        socket.emit('room-created', {
          roomCode,
          playerId,
          reconnectToken,
          room: RoomManager.getSanitizedRoom(roomCode),
        });
      } catch (err) {
        console.error('[create-room]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- join-room ----
    socket.on('join-room', (data) => {
      try {
        let roomCode = data && data.roomCode;
        const playerName = sanitizeString(data && data.playerName, LIMITS.PLAYER_NAME_MAX);

        if (!roomCode || typeof roomCode !== 'string') {
          emitError(socket, 'VALIDATION', 'Room code is required');
          return;
        }
        if (!playerName) {
          emitError(socket, 'VALIDATION', 'Player name is required');
          return;
        }

        roomCode = roomCode.trim();
        if (!/^\d{6}$/.test(roomCode)) {
          emitError(socket, 'VALIDATION', 'Room code must be 6 digits');
          return;
        }

        const result = RoomManager.joinRoom(roomCode, socket.id, playerName);

        if (result.error) {
          emitError(socket, 'ROOM', result.error);
          return;
        }

        const { playerId, reconnectToken, player } = result;

        socket.join(roomCode);
        socket.emit('room-joined', {
          roomCode,
          playerId,
          reconnectToken,
          room: RoomManager.getSanitizedRoom(roomCode),
        });

        // Notify others in the room
        const sanitizedPlayer = {
          id: player.id,
          name: player.name,
          isHost: player.isHost,
          score: player.score,
          isConnected: player.isConnected,
        };

        socket.to(roomCode).emit('player-joined', {
          player: sanitizedPlayer,
          room: RoomManager.getSanitizedRoom(roomCode),
        });
      } catch (err) {
        console.error('[join-room]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- leave-room ----
    socket.on('leave-room', () => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) return;

        const { roomCode, playerId, room } = roomInfo;

        if (room.state === 'playing') return;

        socket.leave(roomCode);

        const result = RoomManager.leaveRoom(roomCode, playerId);

        if (result.roomDeleted) {
          return;
        }

        socket.to(roomCode).emit('player-left', {
          playerId,
          newHost: result.newHost || null,
        });

        io.to(roomCode).emit('room-updated', {
          room: RoomManager.getSanitizedRoom(roomCode),
        });
      } catch (err) {
        console.error('[leave-room]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- reconnect ----
    socket.on('reconnect-game', (data) => {
      try {
        const reconnectToken = data && data.reconnectToken;
        if (!reconnectToken) {
          emitError(socket, 'VALIDATION', 'Reconnect token required');
          return;
        }

        const result = RoomManager.reconnectPlayer(socket.id, reconnectToken);
        if (result.error) {
          emitError(socket, 'RECONNECT', result.error);
          return;
        }

        const { roomCode, room, playerId, player } = result;

        socket.join(roomCode);

        socket.emit('reconnected', {
          playerId,
          reconnectToken,
          room: RoomManager.getSanitizedRoom(roomCode),
          gameState: room.gameState ? {
            phase: room.gameState.phase,
            round: room.gameState.round,
            totalRounds: room.gameState.totalRounds,
            word: room.gameState.word,
            imposterWord: room.gameState.imposterWord,
            roles: room.gameState.roles,
            imposters: room.gameState.imposters,
            scores: { ...room.gameState.scores },
            mode: room.gameState.mode,
          } : null,
          currentPhase: room.gameState ? room.gameState.phase : null,
        });

        io.to(roomCode).emit('player-reconnected', { playerId });
        io.to(roomCode).emit('room-updated', {
          room: RoomManager.getSanitizedRoom(roomCode),
        });
      } catch (err) {
        console.error('[reconnect]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- update-settings ----
    socket.on('update-settings', (data) => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          emitError(socket, 'ROOM', 'Room not found');
          return;
        }

        const { roomCode, playerId, room } = roomInfo;

        // Only the host may update settings
        const player = room.players.get(playerId);
        if (!player || !player.isHost) {
          emitError(socket, 'AUTH', 'Only the host can update settings');
          return;
        }

        const settings = data && data.settings;
        const result = RoomManager.updateSettings(roomCode, playerId, settings);

        if (result.error) {
          emitError(socket, 'ROOM', result.error);
          return;
        }

        io.to(roomCode).emit('settings-updated', {
          settings: result.room.settings,
        });
      } catch (err) {
        console.error('[update-settings]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- kick-player ----
    socket.on('kick-player', (data) => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          emitError(socket, 'ROOM', 'Room not found');
          return;
        }

        const { roomCode, playerId, room } = roomInfo;

        // Only the host may kick
        const player = room.players.get(playerId);
        if (!player || !player.isHost) {
          emitError(socket, 'AUTH', 'Only the host can kick players');
          return;
        }

        const targetId = data && data.targetId;
        if (!targetId) {
          emitError(socket, 'VALIDATION', 'Target player ID is required');
          return;
        }

        const result = RoomManager.kickPlayer(roomCode, playerId, targetId);

        if (result.error) {
          emitError(socket, 'ROOM', result.error);
          return;
        }

        // Force the target socket to leave the channel
        const targetSocketId = result.targetSocketId;
        if (targetSocketId) {
          const targetSocket = io.sockets.sockets.get(targetSocketId);
          if (targetSocket) {
            targetSocket.leave(roomCode);
            targetSocket.emit('player-kicked', { reason: 'Kicked by host' });
          }
        }

        // Notify remaining players
        io.to(roomCode).emit('player-left', { playerId: targetId });
        io.to(roomCode).emit('room-updated', {
          room: RoomManager.getSanitizedRoom(roomCode),
        });
      } catch (err) {
        console.error('[kick-player]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- toggle-ready ----
    socket.on('toggle-ready', () => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) return;

        const { roomCode, playerId } = roomInfo;
        const changed = RoomManager.toggleReady(roomCode, playerId);

        if (changed) {
          io.to(roomCode).emit('room-updated', {
            room: RoomManager.getSanitizedRoom(roomCode),
          });
        }
      } catch (err) {
        console.error('[toggle-ready]', err);
      }
    });

    // ---- start-game ----
    socket.on('start-game', () => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          emitError(socket, 'ROOM', 'Room not found');
          return;
        }

        const { roomCode, playerId, room } = roomInfo;

        const player = room.players.get(playerId);
        if (!player || !player.isHost) {
          emitError(socket, 'AUTH', 'Only the host can start the game');
          return;
        }

        const result = GameEngine.startGame(io, room);

        if (result && result.error) {
          emitError(socket, 'ROOM', result.error);
        }
      } catch (err) {
        console.error('[start-game]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- draw ----
    socket.on('draw', (strokeData) => {
      try {
        if (isDrawRateLimited(socket.id)) return;
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) return;

        const { room, playerId } = roomInfo;
        GameEngine.handleDraw(io, room, playerId, strokeData);
      } catch (err) {
        console.error('[draw]', err);
      }
    });

    // ---- draw-start (live streaming) ----
    socket.on('draw-start', (data) => {
      try {
        if (isDrawRateLimited(socket.id)) return;
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) return;

        const { room, playerId } = roomInfo;
        GameEngine.handleDrawStart(io, room, playerId, data);
      } catch (err) {
        console.error('[draw-start]', err);
      }
    });

    // ---- draw-points (live streaming) ----
    socket.on('draw-points', (data) => {
      try {
        if (isDrawRateLimited(socket.id)) return;
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) return;

        const { room, playerId } = roomInfo;
        GameEngine.handleDrawPoints(io, room, playerId, data);
      } catch (err) {
        console.error('[draw-points]', err);
      }
    });

    // ---- draw-end (live streaming) ----
    socket.on('draw-end', (data) => {
      try {
        if (isDrawRateLimited(socket.id)) return;
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) return;

        const { room, playerId } = roomInfo;
        GameEngine.handleDrawEnd(io, room, playerId, data);
      } catch (err) {
        console.error('[draw-end]', err);
      }
    });

    // ---- undo-stroke ----
    socket.on('undo-stroke', () => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) return;

        const { room, playerId } = roomInfo;
        GameEngine.handleUndoStroke(io, room, playerId);
      } catch (err) {
        console.error('[undo-stroke]', err);
      }
    });

    // ---- done-drawing ----
    socket.on('done-drawing', () => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) return;

        const { room, playerId } = roomInfo;
        GameEngine.handleDoneDrawing(io, room, playerId);
      } catch (err) {
        console.error('[done-drawing]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- chat-message ----
    socket.on('chat-message', (data) => {
      try {
        // Rate limit check
        if (isChatRateLimited(socket.id)) {
          emitError(socket, 'RATE_LIMIT', 'Rate limit exceeded');
          return;
        }

        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          emitError(socket, 'ROOM', 'Room not found');
          return;
        }

        const { roomCode, playerId, room } = roomInfo;
        const rawMessage = data && data.message;
        const message = sanitizeString(rawMessage, LIMITS.CHAT_MESSAGE_MAX);

        if (!message) return;

        const player = room.players.get(playerId);
        if (!player) return;

        if (room.state === 'lobby') {
          // Simple lobby chat broadcast
          io.to(roomCode).emit('chat-message', {
            playerId,
            playerName: player.name,
            message,
            timestamp: Date.now(),
          });
        } else if (room.state === 'playing') {
          GameEngine.handleChat(io, room, playerId, message);
        }
      } catch (err) {
        console.error('[chat-message]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- cast-vote ----
    socket.on('cast-vote', (data) => {
      try {
        if (isVoteRateLimited(socket.id)) return;

        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          emitError(socket, 'ROOM', 'Room not found');
          return;
        }

        const { room, playerId } = roomInfo;
        const targetId = data && data.targetId;

        GameEngine.handleVote(io, room, playerId, targetId);
      } catch (err) {
        console.error('[cast-vote]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- guess-word ----
    socket.on('guess-word', (data) => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          emitError(socket, 'ROOM', 'Room not found');
          return;
        }

        const { room, playerId } = roomInfo;
        const guess = sanitizeString(data && data.guess, LIMITS.GUESS_MAX);

        GameEngine.handleWordGuess(io, room, playerId, guess);
      } catch (err) {
        console.error('[guess-word]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- snipe ----
    socket.on('snipe', (data) => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          emitError(socket, 'ROOM', 'Room not found');
          return;
        }

        const { room, playerId } = roomInfo;
        const guess = sanitizeString(data && data.guess, LIMITS.GUESS_MAX);

        GameEngine.handleSnipe(io, room, playerId, guess);
      } catch (err) {
        console.error('[snipe]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- play-again ----
    socket.on('play-again', () => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          socket.emit('removed-from-room', { reason: 'Room no longer exists' });
          return;
        }

        const { room, playerId } = roomInfo;
        GameEngine.handlePlayAgain(io, room, playerId);
      } catch (err) {
        console.error('[play-again]', err);
        emitError(socket, 'INTERNAL', 'An internal error occurred');
      }
    });

    // ---- disconnect ----
    socket.on('disconnect', () => {
      try {
        clearRateLimitData(socket.id);

        const result = RoomManager.disconnectSocket(socket.id);
        if (!result) return;

        const { roomCode, room, playerId, newHost, disconnected } = result;

        if (disconnected || !room.gameState) {
          socket.to(roomCode).emit('player-left', {
            playerId,
            newHost: newHost || null,
          });

          io.to(roomCode).emit('room-updated', {
            room: RoomManager.getSanitizedRoom(roomCode),
          });
          return;
        }

        GameEngine.handleDisconnect(io, room, playerId);

        const wasHost = playerId === room.host;
        if (wasHost) {
          let newHostId = null;
          for (const [id, p] of room.players) {
            if (p.isConnected) {
              newHostId = id;
              break;
            }
          }
          if (!newHostId && room.players.size > 0) {
            const [firstId] = room.players.keys();
            newHostId = firstId;
          }
          if (newHostId) {
            for (const [, p] of room.players) {
              p.isHost = false;
            }
            const h = room.players.get(newHostId);
            if (h) h.isHost = true;
            room.host = newHostId;
            io.to(roomCode).emit('host-changed', { newHostId });
          }
        }

        socket.to(roomCode).emit('player-disconnected', { playerId });

        io.to(roomCode).emit('room-updated', {
          room: RoomManager.getSanitizedRoom(roomCode),
        });
      } catch (err) {
        console.error('[disconnect]', err);
      }
    });

  });
}

module.exports = { setupSocket };
