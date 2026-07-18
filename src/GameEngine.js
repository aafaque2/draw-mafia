const WordBank = require('./WordBank');
const RoomManager = require('./RoomManager');

// ─── Helpers ────────────────────────────────────────────────────────────────

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getConnectedPlayers(room) {
  const result = [];
  room.players.forEach((p, id) => {
    if (p && p.isConnected) result.push(id);
  });
  return result;
}

function clearGameTimer(gameState) {
  if (gameState && gameState.timer) {
    clearTimeout(gameState.timer);
    gameState.timer = null;
  }
}

function sanitizeMessage(msg) {
  if (typeof msg !== 'string') return '';
  return msg.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim().slice(0, 200);
}

// ─── Score calculation ──────────────────────────────────────────────────────

function calculateScores(room, result) {
  const gs = room.gameState;
  const roundScores = {};
  const connected = getConnectedPlayers(room);

  connected.forEach((id) => {
    roundScores[id] = 0;
  });

  const isBlind = gs.mode === 'blind';
  const impostersSet = new Set(gs.imposters);

  const wrongVoters = Object.keys(gs.votes).filter(
    (voterId) => gs.votes[voterId] !== '__skip__' && !impostersSet.has(gs.votes[voterId])
  );

  switch (result.result) {
    case 'caught':
    case 'imposter-disconnected': {
      gs.artists.forEach((id) => {
        if (roundScores[id] !== undefined) {
          roundScores[id] += isBlind ? 120 : 100;
        }
      });
      wrongVoters.forEach((id) => {
        if (roundScores[id] !== undefined) {
          roundScores[id] -= 50;
        }
      });
      break;
    }

    case 'word-guessed': {
      if (result.caughtImposters) {
        result.caughtImposters.forEach((id) => {
          if (roundScores[id] !== undefined) {
            roundScores[id] += 200;
          }
        });
      }
      wrongVoters.forEach((id) => {
        if (roundScores[id] !== undefined) {
          roundScores[id] -= 50;
        }
      });
      break;
    }

    case 'survived': {
      gs.imposters.forEach((id) => {
        if (roundScores[id] !== undefined) {
          roundScores[id] += isBlind ? 180 : 150;
        }
      });
      wrongVoters.forEach((id) => {
        if (roundScores[id] !== undefined) {
          roundScores[id] -= 50;
        }
      });
      break;
    }

    case 'wrong-vote': {
      gs.imposters.forEach((id) => {
        if (roundScores[id] !== undefined) {
          roundScores[id] += isBlind ? 180 : 150;
        }
      });
      wrongVoters.forEach((id) => {
        if (roundScores[id] !== undefined) {
          roundScores[id] -= 50;
        }
      });
      break;
    }

    default:
      break;
  }

  Object.keys(roundScores).forEach((id) => {
    if (gs.scores[id] === undefined) gs.scores[id] = 0;
    gs.scores[id] += roundScores[id];
  });

  return roundScores;
}

// ─── Game Engine ────────────────────────────────────────────────────────────

const GameEngine = {
  startGame(io, room) {
    if (room.state !== 'lobby') return { error: 'Game already in progress' };

    const connected = getConnectedPlayers(room);
    const imposterCount = (room.settings && room.settings.imposterCount) || 1;

    if (connected.length < imposterCount + 2) return { error: 'Not enough players' };

    room.state = 'playing';

    const wordBankSession = WordBank.createSession();

    const scores = {};
    connected.forEach((id) => {
      const player = room.players.get(id);
      scores[id] = player ? RoomManager.getPersistentScore(player.name) : 0;
    });

    room.gameState = {
      mode: (room.settings && room.settings.mode) || 'classic',
      round: 0,
      totalRounds: (room.settings && room.settings.totalRounds) || 3,
      phase: null,
      word: null,
      imposterWord: null,
      imposters: [],
      artists: [],
      turnOrder: [],
      currentTurnIndex: 0,
      currentPass: 1,
      canvasStrokes: [],
      turnStrokes: [],
      votes: {},
      scores,
      timer: null,
      wordBankSession,
    };

    io.to(room.code).emit('game-started');

    GameEngine.startRound(io, room);
  },

  startRound(io, room) {
    const gs = room.gameState;
    clearGameTimer(gs);

    const connected = getConnectedPlayers(room);
    const imposterCount = (room.settings && room.settings.imposterCount) || 1;

    if (connected.length < imposterCount + 2) {
      GameEngine.endGame(io, room);
      return;
    }

    gs.round++;

    const shuffled = shuffleArray(connected);
    gs.imposters = shuffled.slice(0, imposterCount);
    gs.artists = shuffled.slice(imposterCount);

    const category = (room.settings && room.settings.wordCategory) || 'all';
    if (gs.mode === 'blind') {
      const pair = gs.wordBankSession.getWordPair(category);
      gs.word = pair.artistWord;
      gs.imposterWord = pair.imposterWord;
    } else {
      gs.word = gs.wordBankSession.getRandomWord(category);
      gs.imposterWord = null;
    }

    gs.turnOrder = shuffleArray(connected);
    gs.votes = {};
    gs.turnStrokes = [];
    gs.canvasStrokes = [];
    gs.currentTurnIndex = 0;
    gs.currentPass = 1;
    gs.phase = 'role-reveal';
    gs.snipeUsed = false;

    const impostersSet = new Set(gs.imposters);
    connected.forEach((playerId) => {
      const player = room.players.get(playerId);
      if (!player || !player.socketId) return;

      if (gs.mode === 'blind') {
        if (impostersSet.has(playerId)) {
          io.to(player.socketId).emit('role-assigned', {
            role: 'artist',
            word: gs.imposterWord,
          });
        } else {
          io.to(player.socketId).emit('role-assigned', {
            role: 'artist',
            word: gs.word,
          });
        }
      } else {
        if (impostersSet.has(playerId)) {
          io.to(player.socketId).emit('role-assigned', {
            role: 'imposter',
            word: null,
          });
        } else {
          io.to(player.socketId).emit('role-assigned', {
            role: 'artist',
            word: gs.word,
          });
        }
      }
    });

    io.to(room.code).emit('round-started', {
      round: gs.round,
      totalRounds: gs.totalRounds,
      phase: 'role-reveal',
    });

    gs.timer = setTimeout(() => {
      GameEngine.startDrawingPhase(io, room);
    }, 4000);
  },

  startDrawingPhase(io, room) {
    const gs = room.gameState;
    clearGameTimer(gs);

    gs.phase = 'drawing';

    const drawingVisibility =
      (room.settings && room.settings.drawingVisibility) || 'live';

    io.to(room.code).emit('phase-changed', {
      phase: 'drawing',
      drawingVisibility,
    });

    GameEngine.startTurn(io, room);
  },

  startTurn(io, room) {
    const gs = room.gameState;
    clearGameTimer(gs);

    const imposterCount = (room.settings && room.settings.imposterCount) || 1;
    const connected = getConnectedPlayers(room);
    if (connected.length < imposterCount + 2) {
      const connectedImposters = gs.imposters.filter((id) => {
        const p = room.players.get(id);
        return p && p.isConnected;
      });
      if (connectedImposters.length === 0) {
        GameEngine.endRound(io, room, {
          result: 'imposter-disconnected',
          caughtImposters: gs.imposters,
        });
      } else {
        GameEngine.endRound(io, room, { result: 'survived' });
      }
      return;
    }

    const currentPlayer = gs.turnOrder[gs.currentTurnIndex];
    const player = room.players.get(currentPlayer);

    if (!player || !player.isConnected) {
      GameEngine.endTurn(io, room);
      return;
    }

    const drawTime = (room.settings && room.settings.drawTime) || 15;

    io.to(room.code).emit('turn-started', {
      playerId: currentPlayer,
      turnIndex: gs.currentTurnIndex,
      pass: gs.currentPass,
      drawTime,
    });

    gs.timer = setTimeout(() => {
      GameEngine.endTurn(io, room);
    }, drawTime * 1000);
  },

  handleDraw(io, room, playerId, strokeData) {
    const gs = room.gameState;
    if (!gs || gs.phase !== 'drawing') return;

    const currentPlayer = gs.turnOrder[gs.currentTurnIndex];
    if (playerId !== currentPlayer) return;

    if (!strokeData || typeof strokeData !== 'object') return;
    const VALID_TOOLS = new Set(['pen', 'eraser']);
    if (!VALID_TOOLS.has(strokeData.tool)) return;
    if (!Array.isArray(strokeData.points) || strokeData.points.length === 0 || strokeData.points.length > 500) return;
    if (typeof strokeData.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(strokeData.color)) return;
    if (typeof strokeData.size !== 'number' || strokeData.size < 1 || strokeData.size > 100) return;
    for (const pt of strokeData.points) {
      if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') return;
      if (pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) return;
    }

    const drawingVisibility =
      (room.settings && room.settings.drawingVisibility) || 'live';

    if (drawingVisibility === 'live') {
      if (gs.canvasStrokes.length < 2000) {
        gs.canvasStrokes.push(strokeData);
      }
      io.to(room.code).emit('stroke', strokeData);
    } else {
      if (gs.turnStrokes.length < 500) {
        gs.turnStrokes.push(strokeData);
      }
    }
  },

  handleDoneDrawing(io, room, playerId) {
    const gs = room.gameState;
    if (!gs || gs.phase !== 'drawing') return;

    const currentPlayer = gs.turnOrder[gs.currentTurnIndex];
    if (playerId !== currentPlayer) return;

    GameEngine.endTurn(io, room);
  },

  endTurn(io, room) {
    const gs = room.gameState;
    clearGameTimer(gs);

    const drawingVisibility =
      (room.settings && room.settings.drawingVisibility) || 'live';

    if (drawingVisibility === 'reveal' && gs.turnStrokes.length > 0) {
      io.to(room.code).emit('turn-strokes', gs.turnStrokes);
      for (let i = 0; i < gs.turnStrokes.length; i++) {
        gs.canvasStrokes.push(gs.turnStrokes[i]);
      }
      gs.turnStrokes = [];
    }

    const currentPlayer = gs.turnOrder[gs.currentTurnIndex];
    io.to(room.code).emit('turn-ended', { playerId: currentPlayer });

    gs.currentTurnIndex++;

    if (gs.currentTurnIndex >= gs.turnOrder.length) {
      gs.currentPass++;
      gs.currentTurnIndex = 0;
    }

    const drawingPasses = (room.settings && room.settings.drawingPasses) || 2;

    if (gs.currentPass > drawingPasses) {
      GameEngine.startDiscussionPhase(io, room);
    } else {
      GameEngine.startTurn(io, room);
    }
  },

  startDiscussionPhase(io, room) {
    const gs = room.gameState;
    clearGameTimer(gs);

    const discussionTime =
      (room.settings && room.settings.discussionTime) || 60;

    if (discussionTime <= 0) {
      GameEngine.startVotingPhase(io, room);
      return;
    }

    gs.phase = 'discussion';

    io.to(room.code).emit('phase-changed', {
      phase: 'discussion',
      duration: discussionTime,
    });

    gs.timer = setTimeout(() => {
      GameEngine.startVotingPhase(io, room);
    }, discussionTime * 1000);
  },

  handleChat(io, room, playerId, message) {
    const gs = room.gameState;
    if (gs && (gs.phase === 'role-reveal' || gs.phase === 'results' || gs.phase === 'game-over' || gs.phase === 'word-guess')) return;

    const sanitized = sanitizeMessage(message);
    if (!sanitized) return;

    const player = room.players.get(playerId);
    if (!player) return;

    io.to(room.code).emit('chat-message', {
      playerId,
      playerName: player.name || playerId,
      message: sanitized,
      timestamp: Date.now(),
    });
  },

  startVotingPhase(io, room) {
    const gs = room.gameState;
    clearGameTimer(gs);

    gs.phase = 'voting';
    gs.votes = {};

    const votingTime = (room.settings && room.settings.votingTime) || 30;
    const connected = getConnectedPlayers(room);

    io.to(room.code).emit('phase-changed', {
      phase: 'voting',
      duration: votingTime,
      players: connected.map((id) => {
        const p = room.players.get(id);
        return { id, name: (p && p.name) || id };
      }),
    });

    gs.timer = setTimeout(() => {
      GameEngine.resolveVote(io, room);
    }, votingTime * 1000);
  },

  handleVote(io, room, playerId, targetId) {
    const gs = room.gameState;
    if (!gs || gs.phase !== 'voting') return;
    if (gs.votes[playerId] !== undefined) return;
    if (playerId === targetId) return;

    if (targetId === 'skip' || targetId === null || targetId === undefined) {
      gs.votes[playerId] = '__skip__';
    } else {
      if (!room.players.has(targetId)) return;
      gs.votes[playerId] = targetId;
    }

    io.to(room.code).emit('vote-cast', { playerId });

    const connected = getConnectedPlayers(room);
    const allVoted = connected.every((id) => gs.votes[id] !== undefined);
    if (allVoted) {
      GameEngine.resolveVote(io, room);
    }
  },

  resolveVote(io, room) {
    const gs = room.gameState;
    if (!gs || gs.phase === 'results') return;
    clearGameTimer(gs);

    const tally = {};
    Object.values(gs.votes).forEach((targetId) => {
      if (targetId === '__skip__') return;
      tally[targetId] = (tally[targetId] || 0) + 1;
    });

    const targets = Object.keys(tally);
    let maxVotes = 0;
    targets.forEach((id) => {
      if (tally[id] > maxVotes) maxVotes = tally[id];
    });

    const topTargets = targets.filter((id) => tally[id] === maxVotes);

    const impostersSet = new Set(gs.imposters);
    let accusedId = null;
    let wasImposter = false;

    const skipCount = Object.values(gs.votes).filter((v) => v === '__skip__').length;

    if (topTargets.length === 1 && maxVotes > 0 && maxVotes > skipCount) {
      accusedId = topTargets[0];
      wasImposter = impostersSet.has(accusedId);
    }

    io.to(room.code).emit('vote-results', {
      votes: gs.votes,
      accusedId,
      wasImposter,
    });

    if (accusedId && wasImposter) {
      if (gs.mode === 'classic') {
        GameEngine.startWordGuess(io, room, accusedId);
      } else {
        GameEngine.endRound(io, room, {
          result: 'caught',
          caughtImposters: [accusedId],
        });
      }
    } else if (accusedId && !wasImposter) {
      GameEngine.endRound(io, room, {
        result: 'wrong-vote',
        ejectedId: accusedId,
      });
    } else {
      // Tie or all skipped — round counts, continue to next
      GameEngine.endRound(io, room, { result: 'survived' });
    }
  },

  startWordGuess(io, room, imposterId) {
    const gs = room.gameState;
    clearGameTimer(gs);

    gs.phase = 'word-guess';
    gs.caughtImposterId = imposterId;

    const imposter = room.players.get(imposterId);

    io.to(room.code).emit('phase-changed', {
      phase: 'word-guess',
      imposterId,
      imposterName: (imposter && imposter.name) || imposterId,
      duration: 15,
    });

    gs.timer = setTimeout(() => {
      GameEngine.endRound(io, room, {
        result: 'caught',
        caughtImposters: [imposterId],
        wordGuessed: false,
      });
    }, 15000);
  },

  handleWordGuess(io, room, playerId, guess) {
    const gs = room.gameState;
    if (!gs || gs.phase !== 'word-guess') return;
    if (playerId !== gs.caughtImposterId) return;

    clearGameTimer(gs);

    const normalizedGuess = (guess || '').trim().toLowerCase();
    const normalizedWord = (gs.word || '').trim().toLowerCase();

    if (normalizedGuess === normalizedWord) {
      GameEngine.endRound(io, room, {
        result: 'word-guessed',
        caughtImposters: [playerId],
      });
    } else {
      GameEngine.endRound(io, room, {
        result: 'caught',
        caughtImposters: [playerId],
        wordGuessed: false,
      });
    }
  },

  handleSnipe(io, room, playerId, guess) {
    const gs = room.gameState;
    if (!gs || gs.phase !== 'voting') return;
    if (gs.mode === 'blind') return;
    if (!gs.imposters.includes(playerId)) return;
    if (gs.snipeUsed) return;

    gs.snipeUsed = true;

    const normalizedGuess = (guess || '').trim().toLowerCase();
    const normalizedWord = (gs.word || '').trim().toLowerCase();

    const player = room.players.get(playerId);

    if (normalizedGuess === normalizedWord) {
      clearGameTimer(gs);
      io.to(room.code).emit('snipe-result', {
        playerId,
        playerName: (player && player.name) || playerId,
        correct: true,
      });
      GameEngine.endRound(io, room, {
        result: 'word-guessed',
        caughtImposters: [playerId],
      });
    } else {
      io.to(room.code).emit('snipe-result', {
        playerId,
        playerName: (player && player.name) || playerId,
        correct: false,
      });
    }
  },

  endRound(io, room, result) {
    const gs = room.gameState;
    if (!gs || gs.phase === 'results') return;
    clearGameTimer(gs);

    gs.phase = 'results';

    const roundScores = calculateScores(room, result);

    io.to(room.code).emit('round-results', {
      result: result.result,
      word: gs.word,
      imposterWord: gs.imposterWord,
      imposters: gs.imposters,
      scores: { ...gs.scores },
      roundScores,
      round: gs.round,
      totalRounds: gs.totalRounds,
    });

    const gameOver =
      result.result === 'caught' ||
      result.result === 'word-guessed' ||
      result.result === 'imposter-disconnected' ||
      result.result === 'wrong-vote' ||
      gs.round >= gs.totalRounds;

    if (gameOver) {
      gs.timer = setTimeout(() => {
        GameEngine.endGame(io, room);
      }, 5000);
    } else {
      gs.timer = setTimeout(() => {
        room.state = 'lobby';
        io.to(room.code).emit('between-rounds', {
          round: gs.round,
          totalRounds: gs.totalRounds,
          room: RoomManager.getSanitizedRoom(room.code),
        });
      }, 5000);
    }
  },

  endGame(io, room) {
    const gs = room.gameState;
    clearGameTimer(gs);

    room.state = 'lobby';
    room.currentRound = 0;

    Object.keys(gs.scores).forEach((id) => {
      const p = room.players.get(id);
      if (p) {
        RoomManager.setPersistentScore(p.name, gs.scores[id]);
        p.score = RoomManager.getPersistentScore(p.name);
      } else {
        RoomManager.setPersistentScore(id, gs.scores[id]);
      }
    });

    room.players.forEach((p, id) => {
      if (gs.scores[id] === undefined) {
        p.score = RoomManager.getPersistentScore(p.name);
      }
    });

    const finalScores = [];
    room.players.forEach((p, id) => {
      finalScores.push({
        playerId: id,
        playerName: p.name || id,
        score: (gs.scores[id] || 0),
      });
    });
    finalScores.sort((a, b) => b.score - a.score);

    const leaderboard = RoomManager.getLeaderboard(10);

    room.gameState = {
      phase: 'game-over',
      playAgain: new Set(),
      playAgainTimer: null,
    };

    io.to(room.code).emit('game-over', { finalScores, leaderboard });
  },

  handlePlayAgain(io, room, playerId) {
    const gs = room.gameState;
    if (!gs || gs.phase !== 'game-over') return;
    if (gs.playAgain.has(playerId)) return;

    gs.playAgain.add(playerId);

    io.to(room.code).emit('play-again-updated', {
      playAgainPlayers: Array.from(gs.playAgain),
    });

    const totalPlayers = room.players.size;
    const allClicked = gs.playAgain.size >= totalPlayers;

    if (allClicked) {
      GameEngine.finishPlayAgain(io, room);
    } else if (gs.playAgain.size === 1) {
      gs.playAgainTimer = setTimeout(() => {
        GameEngine.finishPlayAgain(io, room);
      }, 30000);
    }
  },

  finishPlayAgain(io, room) {
    const gs = room.gameState;
    if (!gs || gs.phase !== 'game-over') return;

    if (gs.playAgainTimer) {
      clearTimeout(gs.playAgainTimer);
      gs.playAgainTimer = null;
    }

    const toRemove = [];
    room.players.forEach((p, id) => {
      if (!gs.playAgain.has(id)) {
        toRemove.push(id);
      }
    });

    room.gameState = null;

    toRemove.forEach((id) => {
      const p = room.players.get(id);
      if (p) {
        const socket = io.sockets.sockets.get(p.socketId);
        if (socket) {
          socket.leave(room.code);
          socket.emit('removed-from-room', { reason: 'Did not click Play Again' });
        }
        RoomManager.leaveRoom(room.code, id);
      }
    });

    if (room.players.size === 0) {
      RoomManager.deleteRoom(room.code);
      return;
    }

    io.to(room.code).emit('returned-to-lobby', {
      room: RoomManager.getSanitizedRoom(room.code),
    });
  },

  handleDisconnect(io, room, playerId) {
    const gs = room.gameState;
    if (!gs) return;

    if (gs.phase === 'game-over') {
      if (gs.playAgain) gs.playAgain.delete(playerId);
      return;
    }

    if (gs.phase === 'results') {
      Object.keys(gs.scores).forEach((id) => {
        const p = room.players.get(id);
        if (p) {
          RoomManager.setPersistentScore(p.name, gs.scores[id]);
        }
      });
      return;
    }

    if (gs.phase === 'drawing') {
      const currentPlayer = gs.turnOrder[gs.currentTurnIndex];
      if (currentPlayer === playerId) {
        GameEngine.endTurn(io, room);
      }
    }

    if (gs.phase === 'voting' && gs.votes[playerId] === undefined) {
      const connected = getConnectedPlayers(room);
      const allVoted = connected.every((id) => gs.votes[id] !== undefined);
      if (allVoted) {
        GameEngine.resolveVote(io, room);
        return;
      }
    }

    const imposterCount = (room.settings && room.settings.imposterCount) || 1;
    const minPlayers = imposterCount + 2;
    const connected = getConnectedPlayers(room);

    if (connected.length < minPlayers) {
      if (gs.imposters.includes(playerId)) {
        GameEngine.endRound(io, room, {
          result: 'imposter-disconnected',
          caughtImposters: gs.imposters,
        });
      } else {
        const connectedImposters = gs.imposters.filter((id) => {
          const p = room.players.get(id);
          return p && p.isConnected;
        });
        if (connectedImposters.length > 0) {
          GameEngine.endRound(io, room, {
            result: 'survived',
          });
        }
      }
      return;
    }

    if (gs.imposters.includes(playerId)) {
      const connectedImposters = gs.imposters.filter((id) => {
        const p = room.players.get(id);
        return p && p.isConnected;
      });

      if (connectedImposters.length === 0) {
        GameEngine.endRound(io, room, {
          result: 'imposter-disconnected',
          caughtImposters: gs.imposters,
        });
      }
    }
  },

  handleStartNextRound(io, room, playerId) {
    if (room.state !== 'lobby') return;
    const player = room.players.get(playerId);
    if (!player || !player.isHost) return;

    const minPlayers = (room.settings.imposterCount || 1) + 2;
    if (room.players.size < minPlayers) return;

    room.state = 'playing';
    GameEngine.startRound(io, room);
  },
};

module.exports = GameEngine;
