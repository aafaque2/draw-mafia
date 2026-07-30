const { LIMITS, SETTINGS_RANGES, VALID_MODES, VALID_VISIBILITY, VALID_CATEGORIES, TIMING } = require('./constants');
const crypto = require('crypto');

const rooms = new Map();
const socketToRoom = new Map();
const tokenToPlayer = new Map();
const persistentScores = new Map();

const DEFAULT_SETTINGS = {
  mode: 'classic',
  maxPlayers: 8,
  drawTime: 15,
  drawingPasses: 2,
  drawingVisibility: 'live',
  discussionTime: 60,
  votingTime: 30,
  totalRounds: 3,
  wordCategory: 'all',
  imposterCount: 1,
  persistDrawings: false,
};

function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function createRoom(socketId, playerName) {
  const roomCode = generateRoomCode();
  const playerId = generatePlayerId();
  const reconnectToken = generateToken();

  const room = {
    code: roomCode,
    host: playerId,
    players: new Map(),
    settings: { ...DEFAULT_SETTINGS },
    state: 'lobby',
    currentRound: 0,
    gameState: null,
    ready: new Set(),
  };

  room.players.set(playerId, {
    id: playerId,
    name: playerName,
    socketId,
    isConnected: true,
    isHost: true,
    score: getPersistentScore(playerName),
    reconnectToken,
  });

  rooms.set(roomCode, room);
  socketToRoom.set(socketId, { roomCode, playerId });
  tokenToPlayer.set(reconnectToken, { roomCode, playerId });

  return { roomCode, playerId, reconnectToken, room };
}

function joinRoom(roomCode, socketId, playerName) {
  const room = rooms.get(roomCode);
  if (!room) return { error: 'Room not found' };
  if (room.state !== 'lobby') return { error: 'Game already in progress' };
  if (room.players.size >= room.settings.maxPlayers) return { error: 'Room is full' };

  for (const [, p] of room.players) {
    if (p.name.toLowerCase() === playerName.toLowerCase()) {
      return { error: 'Name already taken' };
    }
  }

  const playerId = generatePlayerId();
  const reconnectToken = generateToken();

  room.players.set(playerId, {
    id: playerId,
    name: playerName,
    socketId,
    isConnected: true,
    isHost: false,
    score: getPersistentScore(playerName),
    reconnectToken,
  });

  socketToRoom.set(socketId, { roomCode, playerId });
  tokenToPlayer.set(reconnectToken, { roomCode, playerId });

  const player = room.players.get(playerId);
  return { playerId, reconnectToken, player };
}

function reconnectPlayer(socketId, reconnectToken) {
  const info = tokenToPlayer.get(reconnectToken);
  if (!info) return { error: 'Invalid reconnect token' };

  const room = rooms.get(info.roomCode);
  if (!room) {
    tokenToPlayer.delete(reconnectToken);
    return { error: 'Room not found' };
  }

  const player = room.players.get(info.playerId);
  if (!player) {
    tokenToPlayer.delete(reconnectToken);
    return { error: 'Player not found' };
  }

  const oldSocketId = player.socketId;
  socketToRoom.delete(oldSocketId);

  player.socketId = socketId;
  player.isConnected = true;
  socketToRoom.set(socketId, { roomCode: info.roomCode, playerId: info.playerId });

  return { playerId: info.playerId, roomCode: info.roomCode, room, player };
}

function disconnectSocket(socketId) {
  const info = socketToRoom.get(socketId);
  if (!info) return null;

  const room = rooms.get(info.roomCode);
  if (!room) {
    socketToRoom.delete(socketId);
    return null;
  }

  const player = room.players.get(info.playerId);
  if (!player) {
    socketToRoom.delete(socketId);
    return null;
  }

  player.isConnected = false;

  if (room.state === 'lobby') {
    socketToRoom.delete(socketId);
    room.players.delete(info.playerId);
    tokenToPlayer.delete(player.reconnectToken);
    room.ready.delete(info.playerId);

    if (room.players.size === 0) {
      rooms.delete(info.roomCode);
      return null;
    }

    let newHost = null;
    if (room.host === info.playerId) {
      const [newHostId] = room.players.keys();
      room.host = newHostId;
      const h = room.players.get(newHostId);
      if (h) h.isHost = true;
      newHost = newHostId;
    }

    return { roomCode: info.roomCode, newHost, room, disconnected: true };
  }

  return { roomCode: info.roomCode, room, playerId: info.playerId, disconnected: false };
}

function leaveRoom(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room) return { roomDeleted: true };

  const player = room.players.get(playerId);
  if (!player) return { roomDeleted: true };

  socketToRoom.delete(player.socketId);
  tokenToPlayer.delete(player.reconnectToken);
  room.players.delete(playerId);
  room.ready.delete(playerId);

  if (room.players.size === 0) {
    rooms.delete(roomCode);
    return { roomDeleted: true };
  }

  let newHost = null;
  if (room.host === playerId) {
    const [newHostId] = room.players.keys();
    room.host = newHostId;
    const h = room.players.get(newHostId);
    if (h) h.isHost = true;
    newHost = newHostId;
  }

  return { roomDeleted: false, newHost };
}

function updateSettings(roomCode, playerId, newSettings) {
  const room = rooms.get(roomCode);
  if (!room) return { error: 'Room not found' };
  if (room.state !== 'lobby') return { error: 'Game already in progress' };

  const player = room.players.get(playerId);
  if (!player || !player.isHost) return { error: 'Only host can update settings' };

  if (!newSettings || typeof newSettings !== 'object') return { error: 'Invalid settings' };

  const validated = {};
  for (const key of Object.keys(newSettings)) {
    if (!(key in room.settings)) continue;
    let val = newSettings[key];

    if (typeof val === 'string') val = val.trim();

    switch (key) {
      case 'mode':
        if (!VALID_MODES.includes(val)) continue;
        break;
      case 'drawingVisibility':
        if (!VALID_VISIBILITY.includes(val)) continue;
        break;
      case 'wordCategory': {
        if (!VALID_CATEGORIES.includes(val)) continue;
        break;
      }
      case 'persistDrawings':
        val = val === true || val === 'true';
        break;
      default:
        if (typeof val === 'number' && SETTINGS_RANGES[key]) {
          const r = SETTINGS_RANGES[key];
          val = Math.max(r.min, Math.min(r.max, Math.round(val)));
        } else if (typeof val === 'string' && !isNaN(Number(val))) {
          val = Number(val);
          if (SETTINGS_RANGES[key]) {
            const r = SETTINGS_RANGES[key];
            val = Math.max(r.min, Math.min(r.max, Math.round(val)));
          }
        }
    }

    validated[key] = val;
  }

  if (validated.imposterCount === 2 && room.players.size < 6) {
    validated.imposterCount = 1;
  }

  Object.assign(room.settings, validated);
  return { success: true, room };
}

function kickPlayer(roomCode, hostId, targetId) {
  const room = rooms.get(roomCode);
  if (!room) return { error: 'Room not found' };

  const host = room.players.get(hostId);
  if (!host || !host.isHost) return { error: 'Only host can kick players' };

  const target = room.players.get(targetId);
  if (!target) return { error: 'Player not found' };
  if (targetId === hostId) return { error: 'Cannot kick yourself' };

  const targetSocketId = target.socketId;
  socketToRoom.delete(target.socketId);
  tokenToPlayer.delete(target.reconnectToken);
  room.players.delete(targetId);
  room.ready.delete(targetId);

  return { success: true, targetSocketId };
}

function getRoom(roomCode) {
  return rooms.get(roomCode) || null;
}

function getRoomBySocketId(socketId) {
  const info = socketToRoom.get(socketId);
  if (!info) return null;

  const room = rooms.get(info.roomCode);
  if (!room) {
    socketToRoom.delete(socketId);
    return null;
  }

  const player = room.players.get(info.playerId);
  if (!player) {
    socketToRoom.delete(socketId);
    return null;
  }

  return { roomCode: info.roomCode, playerId: info.playerId, room };
}

function toggleReady(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== 'lobby') return false;
  if (!room.players.has(playerId)) return false;
  if (room.players.get(playerId).isHost) return false;

  if (room.ready.has(playerId)) {
    room.ready.delete(playerId);
  } else {
    room.ready.add(playerId);
  }
  return true;
}

function getSanitizedRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const players = [];
  room.players.forEach((p) => {
    players.push({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      score: p.score,
      isConnected: p.isConnected,
      ready: room.ready.has(p.id),
    });
  });

  return {
    code: room.code,
    host: room.host,
    players,
    settings: { ...room.settings },
    state: room.state,
    playerCount: room.players.size,
  };
}

function deleteRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (room) {
    room.players.forEach((p) => {
      socketToRoom.delete(p.socketId);
      tokenToPlayer.delete(p.reconnectToken);
    });
    rooms.delete(roomCode);
  }
}

function getPersistentScore(name) {
  if (!name) return 0;
  return persistentScores.get(name.toLowerCase()) || 0;
}

function setPersistentScore(name, score) {
  if (!name) return;
  const key = name.toLowerCase();
  persistentScores.set(key, score);
  if (persistentScores.size > LIMITS.PERSISTENT_SCORES_MAX) {
    const oldest = persistentScores.keys().next().value;
    persistentScores.delete(oldest);
  }
}

function getLeaderboard(count) {
  const entries = [];
  persistentScores.forEach((score, name) => {
    entries.push({ name, score });
  });
  entries.sort((a, b) => b.score - a.score);
  return entries.slice(0, count || 10);
}

setInterval(() => {
  rooms.forEach((room, code) => {
    if (room.players.size === 0) {
      rooms.delete(code);
    }
  });
}, TIMING.ROOM_CLEANUP_INTERVAL);

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  disconnectSocket,
  reconnectPlayer,
  updateSettings,
  kickPlayer,
  getRoom,
  getRoomBySocketId,
  getSanitizedRoom,
  toggleReady,
  deleteRoom,
  getPersistentScore,
  setPersistentScore,
  getLeaderboard,
};
