const crypto = require('crypto');
const rooms = new Map();
const socketToRoom = new Map();
const persistentScores = new Map();
const MAX_PERSISTENT_SCORES = 5000;

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

const SETTINGS_RANGES = {
  maxPlayers: { min: 3, max: 12 },
  drawTime: { min: 5, max: 30 },
  drawingPasses: { min: 1, max: 3 },
  discussionTime: { min: 10, max: 180 },
  votingTime: { min: 15, max: 90 },
  totalRounds: { min: 1, max: 10 },
  imposterCount: { min: 1, max: 2 },
};

function generateRoomCode() {
  let code;
  do {
    code = crypto.randomBytes(3).toString('hex').toUpperCase();
  } while (rooms.has(code));
  return code;
}

function createRoom(socketId, playerName) {
  const roomCode = generateRoomCode();
  const playerId = socketId;

  const room = {
    code: roomCode,
    host: playerId,
    players: new Map(),
    settings: { ...DEFAULT_SETTINGS },
    state: 'lobby',
    currentRound: 0,
    gameState: null,
  };

  room.players.set(playerId, {
    id: playerId,
    name: playerName,
    socketId,
    isConnected: true,
    isHost: true,
    score: getPersistentScore(playerName),
  });

  rooms.set(roomCode, room);
  socketToRoom.set(socketId, { roomCode, playerId });

  return { roomCode, playerId, room };
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

  const playerId = socketId;

  room.players.set(playerId, {
    id: playerId,
    name: playerName,
    socketId,
    isConnected: true,
    isHost: false,
    score: getPersistentScore(playerName),
  });

  socketToRoom.set(socketId, { roomCode, playerId });

  const player = room.players.get(playerId);
  return { playerId, player };
}

function leaveRoom(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room) return { roomDeleted: true };

  const player = room.players.get(playerId);
  if (!player) return { roomDeleted: true };

  socketToRoom.delete(player.socketId);
  room.players.delete(playerId);

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
        if (val !== 'classic' && val !== 'blind') continue;
        break;
      case 'drawingVisibility':
        if (val !== 'live' && val !== 'reveal') continue;
        break;
      case 'wordCategory': {
        const valid = ['all', 'animals', 'food', 'objects', 'places', 'actions'];
        if (!valid.includes(val)) continue;
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
  room.players.delete(targetId);

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

  return { roomCode: info.roomCode, playerId: info.playerId, room };
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
  if (persistentScores.size > MAX_PERSISTENT_SCORES) {
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
}, 60000);

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  updateSettings,
  kickPlayer,
  getRoom,
  getRoomBySocketId,
  getSanitizedRoom,
  deleteRoom,
  getPersistentScore,
  setPersistentScore,
  getLeaderboard,
};
