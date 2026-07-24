const RoomManager = require('./RoomManager');
const GameEngine = require('./GameEngine');

// --- Helper ---

/** Max strokes per socket per second for draw events */
const DRAW_RATE_LIMIT_WINDOW_MS = 1000;
const DRAW_RATE_LIMIT_MAX = 60;
const drawTimestamps = new Map();

/** Max rooms a single socket can create per minute */
const CREATE_RATE_LIMIT_WINDOW_MS = 60000;
const CREATE_RATE_LIMIT_MAX = 5;
const createTimestamps = new Map();

/**
 * Strip HTML tags, trim, and truncate.
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
function sanitizeString(str, maxLength = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}

// --- Rate Limiter (sliding-window per socket) ---

/** @type {Map<string, number[]>} socketId → array of timestamps */
const chatTimestamps = new Map();

const RATE_LIMIT_WINDOW_MS = 1000; // 1 second
const RATE_LIMIT_MAX = 3;          // max messages per window

/**
 * Returns true if the socket has exceeded the chat rate limit.
 * @param {string} socketId
 * @returns {boolean}
 */
function isRateLimited(socketId) {
  const now = Date.now();
  let timestamps = chatTimestamps.get(socketId);

  if (!timestamps) {
    timestamps = [];
    chatTimestamps.set(socketId, timestamps);
  }

  // Purge timestamps outside the window
  while (timestamps.length > 0 && timestamps[0] <= now - RATE_LIMIT_WINDOW_MS) {
    timestamps.shift();
  }

  if (timestamps.length >= RATE_LIMIT_MAX) {
    return true;
  }

  timestamps.push(now);
  return false;
}

/**
 * Returns true if the socket has exceeded the draw rate limit.
 * @param {string} socketId
 * @returns {boolean}
 */
function isDrawRateLimited(socketId) {
  const now = Date.now();
  let timestamps = drawTimestamps.get(socketId);
  if (!timestamps) {
    timestamps = [];
    drawTimestamps.set(socketId, timestamps);
  }
  while (timestamps.length > 0 && timestamps[0] <= now - DRAW_RATE_LIMIT_WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= DRAW_RATE_LIMIT_MAX) return true;
  timestamps.push(now);
  return false;
}

/**
 * Returns true if the socket has exceeded the create-room rate limit.
 * @param {string} socketId
 * @returns {boolean}
 */
function isCreateRateLimited(socketId) {
  const now = Date.now();
  let timestamps = createTimestamps.get(socketId);
  if (!timestamps) {
    timestamps = [];
    createTimestamps.set(socketId, timestamps);
  }
  while (timestamps.length > 0 && timestamps[0] <= now - CREATE_RATE_LIMIT_WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= CREATE_RATE_LIMIT_MAX) return true;
  timestamps.push(now);
  return false;
}

/**
 * Remove rate-limit tracking data for a disconnected socket.
 * @param {string} socketId
 */
function clearRateLimitData(socketId) {
  chatTimestamps.delete(socketId);
  drawTimestamps.delete(socketId);
  createTimestamps.delete(socketId);
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
          socket.emit('error', { message: 'Too many rooms created. Wait a moment.' });
          return;
        }

        const playerName = sanitizeString(data && data.playerName, 20);
        if (!playerName) {
          socket.emit('error', { message: 'Player name is required' });
          return;
        }

        const { roomCode, playerId, room } = RoomManager.createRoom(socket.id, playerName);

        socket.join(roomCode);
        socket.emit('room-created', {
          roomCode,
          playerId,
          room: RoomManager.getSanitizedRoom(roomCode),
        });
      } catch (err) {
        console.error('[create-room]', err);
        socket.emit('error', { message: 'An error occurred' });
      }
    });

    // ---- join-room ----
    socket.on('join-room', (data) => {
      try {
        let roomCode = data && data.roomCode;
        const playerName = sanitizeString(data && data.playerName, 20);

        if (!roomCode || typeof roomCode !== 'string') {
          socket.emit('error', { message: 'Room code is required' });
          return;
        }
        if (!playerName) {
          socket.emit('error', { message: 'Player name is required' });
          return;
        }

        roomCode = roomCode.trim().toUpperCase();
        if (!/^[A-Z0-9]{1,10}$/.test(roomCode)) {
          socket.emit('error', { message: 'Invalid room code format' });
          return;
        }

        const result = RoomManager.joinRoom(roomCode, socket.id, playerName);

        if (result.error) {
          socket.emit('error', { message: result.error });
          return;
        }

        const { playerId, player } = result;

        socket.join(roomCode);
        socket.emit('room-joined', {
          roomCode,
          playerId,
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
        socket.emit('error', { message: 'An error occurred' });
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
        socket.emit('error', { message: 'An error occurred' });
      }
    });

    // ---- update-settings ----
    socket.on('update-settings', (data) => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const { roomCode, playerId, room } = roomInfo;

        // Only the host may update settings
        const player = room.players.get(playerId);
        if (!player || !player.isHost) {
          socket.emit('error', { message: 'Only the host can update settings' });
          return;
        }

        const settings = data && data.settings;
        const result = RoomManager.updateSettings(roomCode, playerId, settings);

        if (result.error) {
          socket.emit('error', { message: result.error });
          return;
        }

        io.to(roomCode).emit('settings-updated', {
          settings: result.room.settings,
        });
      } catch (err) {
        console.error('[update-settings]', err);
        socket.emit('error', { message: 'An error occurred' });
      }
    });

    // ---- kick-player ----
    socket.on('kick-player', (data) => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const { roomCode, playerId, room } = roomInfo;

        // Only the host may kick
        const player = room.players.get(playerId);
        if (!player || !player.isHost) {
          socket.emit('error', { message: 'Only the host can kick players' });
          return;
        }

        const targetId = data && data.targetId;
        if (!targetId) {
          socket.emit('error', { message: 'Target player ID is required' });
          return;
        }

        const result = RoomManager.kickPlayer(roomCode, playerId, targetId);

        if (result.error) {
          socket.emit('error', { message: result.error });
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
        socket.emit('error', { message: 'An error occurred' });
      }
    });

    // ---- start-game ----
    socket.on('start-game', () => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const { roomCode, playerId, room } = roomInfo;

        const player = room.players.get(playerId);
        if (!player || !player.isHost) {
          socket.emit('error', { message: 'Only the host can start the game' });
          return;
        }

        const result = GameEngine.startGame(io, room);

        if (result && result.error) {
          socket.emit('error', { message: result.error });
        }
      } catch (err) {
        console.error('[start-game]', err);
        socket.emit('error', { message: 'An error occurred' });
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

    // ---- done-drawing ----
    socket.on('done-drawing', () => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) return;

        const { room, playerId } = roomInfo;
        GameEngine.handleDoneDrawing(io, room, playerId);
      } catch (err) {
        console.error('[done-drawing]', err);
        socket.emit('error', { message: 'An error occurred' });
      }
    });

    // ---- chat-message ----
    socket.on('chat-message', (data) => {
      try {
        // Rate limit check
        if (isRateLimited(socket.id)) {
          socket.emit('error', { message: 'Rate limit exceeded' });
          return;
        }

        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const { roomCode, playerId, room } = roomInfo;
        const rawMessage = data && data.message;
        const message = sanitizeString(rawMessage, 200);

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
        socket.emit('error', { message: 'An error occurred' });
      }
    });

    // ---- cast-vote ----
    socket.on('cast-vote', (data) => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const { room, playerId } = roomInfo;
        const targetId = data && data.targetId;

        GameEngine.handleVote(io, room, playerId, targetId);
      } catch (err) {
        console.error('[cast-vote]', err);
        socket.emit('error', { message: 'An error occurred' });
      }
    });

    // ---- guess-word ----
    socket.on('guess-word', (data) => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const { room, playerId } = roomInfo;
        const guess = sanitizeString(data && data.guess, 50);

        GameEngine.handleWordGuess(io, room, playerId, guess);
      } catch (err) {
        console.error('[guess-word]', err);
        socket.emit('error', { message: 'An error occurred' });
      }
    });

    // ---- snipe ----
    socket.on('snipe', (data) => {
      try {
        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const { room, playerId } = roomInfo;
        const guess = sanitizeString(data && data.guess, 50);

        GameEngine.handleSnipe(io, room, playerId, guess);
      } catch (err) {
        console.error('[snipe]', err);
        socket.emit('error', { message: 'An error occurred' });
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
        socket.emit('error', { message: 'An error occurred' });
      }
    });

    // ---- disconnect ----
    socket.on('disconnect', () => {
      try {
        clearRateLimitData(socket.id);

        const roomInfo = RoomManager.getRoomBySocketId(socket.id);
        if (!roomInfo) return;

        const { roomCode, playerId, room } = roomInfo;

        const player = room.players.get(playerId);

        if (room.state === 'playing' && room.gameState) {
          const wasHost = player && player.isHost;

          if (player) {
            player.isConnected = false;
          }

          GameEngine.handleDisconnect(io, room, playerId);

          const result = RoomManager.leaveRoom(roomCode, playerId);

          if (wasHost && !result.roomDeleted) {
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

          socket.to(roomCode).emit('player-disconnected', {
            playerId,
          });

          if (!result.roomDeleted) {
            io.to(roomCode).emit('room-updated', {
              room: RoomManager.getSanitizedRoom(roomCode),
            });
          }
        } else if (room.gameState && room.gameState.phase === 'game-over') {
          GameEngine.handleDisconnect(io, room, playerId);

          const wasHost = player && player.isHost;
          const result = RoomManager.leaveRoom(roomCode, playerId);

          if (wasHost && !result.roomDeleted) {
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

          if (!result.roomDeleted) {
            socket.to(roomCode).emit('player-left', {
              playerId,
              newHost: result.newHost || null,
            });

            io.to(roomCode).emit('room-updated', {
              room: RoomManager.getSanitizedRoom(roomCode),
            });
          }
        } else {
          const result = RoomManager.leaveRoom(roomCode, playerId);

          if (!result.roomDeleted) {
            socket.to(roomCode).emit('player-left', {
              playerId,
              newHost: result.newHost || null,
            });

            io.to(roomCode).emit('room-updated', {
              room: RoomManager.getSanitizedRoom(roomCode),
            });
          }
        }
      } catch (err) {
        console.error('[disconnect]', err);
      }
    });

  });
}

module.exports = { setupSocket };
