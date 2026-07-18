/* ═══════════════════════════════════════════════════════════
   APP.JS — Main controller, socket wiring, state management
   ═══════════════════════════════════════════════════════════ */

(() => {
  const state = {
    socket: null,
    myId: null,
    myName: '',
    roomCode: null,
    isHost: false,
    currentScreen: 'home',
    roomState: 'lobby',
    settings: {},
    players: [],
    myRole: null,
    myWord: null,
    currentPhase: null,
    currentTurnId: null,
    votes: {},
    selectedVote: null,
    uiTimerHandle: null,
    timerStart: 0,
    timerDuration: 0,
    codeRevealed: true,
    betweenRound: false,
  };

  const $ = (s) => document.querySelector(s);

  // ── Socket ────────────────────────────────────────────────
  function connectSocket() {
    state.socket = io({ transports: ['websocket', 'polling'] });

    state.socket.on('connect', () => {
      console.log('Connected:', state.socket.id);
      UI.toast('Connected', 'success');
    });

    state.socket.on('disconnect', () => {
      UI.toast('Connection lost. Reconnecting...', 'error');
    });

    state.socket.on('reconnect', () => {
      UI.toast('Reconnected!', 'success');
      if (state.roomCode) {
        if (state.roomState === 'playing' || state.roomState === 'lobby') {
          state.socket.emit('join-room', { roomCode: state.roomCode, playerName: state.myName });
        }
      }
    });

    state.socket.on('error', (data) => UI.toast(data.message || 'Error', 'error'));

    // ── Room events ──
    state.socket.on('room-created', (data) => {
      state.roomCode = data.roomCode;
      state.myId = data.playerId;
      state.isHost = true;
      state.codeRevealed = false;
      applyRoomState(data.room);
      showScreen('lobby');
      updateLobbyCodeDisplay();
    });

    state.socket.on('room-joined', (data) => {
      state.roomCode = data.roomCode;
      state.myId = data.playerId;
      state.codeRevealed = false;
      applyRoomState(data.room);
      showScreen('lobby');
      updateLobbyCodeDisplay();
    });

    state.socket.on('player-joined', (data) => {
      if (data.room) applyRoomState(data.room);
      AudioEngine.playDing();
    });

    state.socket.on('player-left', (data) => {
      if (data.newHost === state.myId) {
        state.isHost = true;
        UI.toast('You are now the host', 'info');
      }
      if (data.room) applyRoomState(data.room);
      else updateLobbyPlayers();
    });

    state.socket.on('host-changed', (data) => {
      if (data.newHostId === state.myId) {
        state.isHost = true;
        UI.toast('You are now the host', 'info');
      } else {
        state.isHost = false;
      }
    });

    state.socket.on('player-kicked', () => {
      UI.toast('You were kicked by the host', 'error');
      resetState();
      showScreen('home');
    });

    state.socket.on('room-updated', (data) => {
      if (data.room) {
        applyRoomState(data.room);
        if (state.roomState === 'playing') {
          updateGamePlayerList();
        }
      }
    });

    state.socket.on('settings-updated', (data) => {
      state.settings = data.settings;
      renderLobbySettings();
    });

    // ── Game events ──
    state.socket.on('game-started', () => { state.roomState = 'playing'; });

    state.socket.on('role-assigned', (data) => {
      state.myRole = data.role;
      state.myWord = data.word;
    });

    state.socket.on('round-started', (data) => {
      state.betweenRound = false;
      state.currentPhase = 'role-reveal';
      const gRound = $('#g-round');
      if (gRound) gRound.textContent = 'Round ' + data.round + '/' + data.totalRounds;
      showRoleReveal(data);
    });

    state.socket.on('phase-changed', (data) => {
      state.currentPhase = data.phase;
      removeSnipeOverlay();
      switch (data.phase) {
        case 'drawing':
          showScreen('game');
          hideAllBottomBars();
          DrawCanvas.clearCanvas();
          DrawCanvas.disableDrawing();
          requestAnimationFrame(() => {
            DrawCanvas.resize();
            setupGameScreen();
            const discOverlay = $('#disc-overlay');
            if (discOverlay) discOverlay.style.display = 'none';
            const gPhase = $('#g-phase');
            if (gPhase) gPhase.textContent = 'Drawing';
          });
          break;
        case 'discussion':
          DrawCanvas.disableDrawing();
          hideAllBottomBars();
          if (state.settings.mode === 'blind') {
            const wb1 = $('#g-word-bar');
            if (wb1) wb1.style.display = 'none';
          }
          const discTools = $('#disc-tools');
          if (discTools) discTools.style.display = '';
          const discOv = $('#disc-overlay');
          if (discOv) discOv.style.display = '';
          const drawTools1 = $('#draw-tools');
          if (drawTools1) drawTools1.style.display = 'none';
          const gPhase1 = $('#g-phase');
          if (gPhase1) gPhase1.textContent = 'Discussion';
          if (state.currentScreen !== 'game') {
            showScreen('game');
            requestAnimationFrame(() => {
              DrawCanvas.resize();
              DrawCanvas.copyToDiscussion();
            });
          }
          startTimer('g', data.duration);
          break;
        case 'voting':
          DrawCanvas.disableDrawing();
          hideAllBottomBars();
          if (state.settings.mode === 'blind') {
            const wb2 = $('#g-word-bar');
            if (wb2) wb2.style.display = 'none';
          }
          const voteTools = $('#vote-tools');
          if (voteTools) voteTools.style.display = '';
          const discOv2 = $('#disc-overlay');
          if (discOv2) discOv2.style.display = 'none';
          const drawTools2 = $('#draw-tools');
          if (drawTools2) drawTools2.style.display = 'none';
          const gPhase2 = $('#g-phase');
          if (gPhase2) gPhase2.textContent = 'Voting';
          showInlineVoting(data);
          startTimer('g', data.duration);
          break;
        case 'word-guess':
          showWordGuessOverlay(data);
          break;
      }
    });

    state.socket.on('turn-started', (data) => {
      state.currentTurnId = data.playerId;
      updateGameTurn(data);
      startTimer('g', data.drawTime);
    });

    state.socket.on('turn-ended', (data) => {
      state.currentTurnId = null;
      const banner = $('#turn-banner');
      if (banner) banner.style.display = 'none';
      DrawCanvas.disableDrawing();
      const drawTools = $('#draw-tools');
      if (drawTools) drawTools.style.display = 'none';
    });

    state.socket.on('stroke', (data) => DrawCanvas.addRemoteStroke(data));

    state.socket.on('turn-strokes', (data) => DrawCanvas.revealTurnStrokes(data));

    state.socket.on('chat-message', (data) => {
      AudioEngine.playMessage();
      ['chat-lobby', 'chat-game'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          UI.renderChat(el, data);
          while (el.children.length > 200) {
            el.removeChild(el.firstChild);
          }
        }
      });
    });

    state.socket.on('vote-cast', (data) => {
      state.votes[data.playerId] = true;
      updateInlineVoteCount();
    });

    state.socket.on('vote-results', (data) => {
      state.votes = data.votes || {};
      updateInlineVoteCount();
    });

    state.socket.on('round-results', (data) => showResults(data));

    state.socket.on('snipe-result', (data) => {
      if (data.correct) {
        UI.toast(data.playerName + ' sniped the word!', 'success');
        AudioEngine.playWinFanfare();
      } else {
        UI.toast(data.playerName + ' missed the snipe!', 'error');
        AudioEngine.playLoseBuzzer();
      }
    });

    state.socket.on('game-over', (data) => showGameOver(data));

    state.socket.on('between-rounds', (data) => {
      state.betweenRound = true;
      state.myRole = null;
      state.myWord = null;
      state.currentPhase = null;
      state.currentTurnId = null;
      state.votes = {};
      state.selectedVote = null;
      DrawCanvas.clearCanvas();
      clearUITimer();
      removeSnipeOverlay();
      if (data && data.room) applyRoomState(data.room);
      UI.toast('Round ' + data.round + ' of ' + data.totalRounds + ' complete', 'info');
      showScreen('lobby');
      updateLobbyPlayers();
      renderLobbySettings();
      updateStartButton();
    });

    state.socket.on('returned-to-lobby', (data) => {
      state.roomState = 'lobby';
      state.myRole = null;
      state.myWord = null;
      state.currentPhase = null;
      state.currentTurnId = null;
      state.votes = {};
      state.selectedVote = null;
      DrawCanvas.clearCanvas();
      clearUITimer();
      if (data && data.room) applyRoomState(data.room);
      showScreen('lobby');
      updateLobbyPlayers();
      renderLobbySettings();
      updateStartButton();
    });

    state.socket.on('removed-from-room', (data) => {
      UI.toast(data.reason || 'You were removed from the room', 'error');
      resetState();
      showScreen('home');
    });

    state.socket.on('play-again-updated', (data) => {
      updatePlayAgainStatus(data.playAgainPlayers || []);
    });

    state.socket.on('player-disconnected', () => {
      UI.toast('A player disconnected', 'info');
    });
  }

  // ── Room state ────────────────────────────────────────────
  function applyRoomState(room) {
    state.players = room.players || [];
    state.settings = room.settings || {};
    state.isHost = room.host === state.myId;
    updateLobbyPlayers();
    renderLobbySettings();
    updateStartButton();
  }

  function updateLobbyCodeDisplay() {
    const codeEl = $('#lobby-code');
    if (!codeEl) return;
    if (state.codeRevealed) {
      codeEl.textContent = state.roomCode || '------';
      codeEl.classList.remove('hidden-code');
      $('#eye-open').style.display = '';
      $('#eye-closed').style.display = 'none';
    } else {
      codeEl.textContent = state.roomCode ? '•'.repeat(state.roomCode.length) : '••••••';
      codeEl.classList.add('hidden-code');
      $('#eye-open').style.display = 'none';
      $('#eye-closed').style.display = '';
    }
  }

  function updateLobbyPlayers() {
    const container = document.getElementById('lobby-players');
    if (!container) return;
    UI.renderPlayerList(container, state.players, {
      myId: state.myId,
      isHost: state.isHost,
      onKick: (targetId) => state.socket.emit('kick-player', { targetId }),
    });
    updateStartButton();
  }

  function updateStartButton() {
    const btn = $('#btn-start');
    if (!btn) return;
    const imposterCount = (state.settings && state.settings.imposterCount) || 1;
    const minPlayers = imposterCount + 2;
    const canStart = state.isHost && state.players.length >= minPlayers;
    btn.disabled = !canStart;
    if (state.betweenRound) {
      if (canStart) btn.textContent = 'Start Next Round';
      else if (state.isHost) btn.textContent = `Start Next Round (${state.players.length}/${minPlayers} min)`;
      else btn.textContent = 'Waiting for host...';
    } else {
      if (canStart) btn.textContent = 'Start Game';
      else if (state.isHost) btn.textContent = `Start Game (${state.players.length}/${minPlayers} min)`;
      else btn.textContent = 'Waiting for host...';
    }
  }

  function renderLobbySettings() {
    const section = $('#settings-section');
    const container = $('#settings-controls');
    if (!section || !container) return;
    section.style.display = (state.isHost && !state.betweenRound) ? '' : 'none';
    UI.renderSettings(container, state.settings, state.isHost && !state.betweenRound, (changes) => {
      state.socket.emit('update-settings', { settings: changes });
    });
  }

  // ── Screens ───────────────────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const screen = document.getElementById('screen-' + name);
    if (screen) {
      screen.classList.add('active');
      state.currentScreen = name;
    }
  }

  // ── Role Reveal ───────────────────────────────────────────
  function showRoleReveal(data) {
    const icon = $('#reveal-role-icon');
    const title = $('#reveal-title');
    const word = $('#reveal-word');

    if (state.myRole === 'imposter') {
      icon.textContent = '🎭';
      title.textContent = 'You are the Imposter!';
      title.className = 'reveal-title imposter';
      word.innerHTML = 'Observe and blend in. <em>You don\'t know the word.</em>';
    } else {
      icon.textContent = '🎨';
      title.textContent = 'You are an Artist!';
      title.className = 'reveal-title artist';
      word.innerHTML = 'The word is: <strong>' + UI.escapeHtml(state.myWord || '???') + '</strong>';
    }

    $('#reveal-round').textContent = data.round;
    $('#reveal-total').textContent = data.totalRounds;
    showScreen('role-reveal');
    AudioEngine.playReveal();
  }

  // ── Game Screen ───────────────────────────────────────────
  function setupGameScreen() {
    updateGamePlayerList();
    const wordBar = $('#g-word-bar');
    if (wordBar) wordBar.style.display = '';
    if (state.myRole === 'imposter' && state.settings.mode === 'classic') {
      wordBar.textContent = '???';
    } else {
      wordBar.textContent = state.myWord || '';
    }
  }

  function updateGameTurn(data) {
    updateGamePlayerList();
    const banner = $('#turn-banner');
    const bannerText = $('#turn-banner-text');

    if (data.playerId === state.myId) {
      banner.style.display = '';
      bannerText.textContent = 'Your Turn!';
      DrawCanvas.enableDrawing();
      $('#draw-tools').style.display = '';
      AudioEngine.playDing();
    } else {
      banner.style.display = 'none';
      DrawCanvas.disableDrawing();
      if (state.currentPhase === 'drawing') $('#draw-tools').style.display = 'none';
      const player = state.players.find((p) => p.id === data.playerId);
      bannerText.textContent = (player ? player.name : '???') + '\'s turn';
    }
  }

  function updateGamePlayerList() {
    const container = document.getElementById('g-players');
    if (!container) return;
    UI.renderPlayerList(container, state.players, {
      currentTurnId: state.currentTurnId,
      myId: state.myId,
      isHost: false,
    });
  }

  // ── Voting (inline in game screen) ───────────────────────
  function hideAllBottomBars() {
    const drawTools = $('#draw-tools');
    if (drawTools) drawTools.style.display = 'none';
    const discTools = $('#disc-tools');
    if (discTools) discTools.style.display = 'none';
    const voteTools = $('#vote-tools');
    if (voteTools) voteTools.style.display = 'none';
  }

  function showInlineVoting(data) {
    state.selectedVote = null;
    state.votes = {};
    const votePlayers = data.players;
    const container = $('#vote-cards-inline');

    function onVoteSelect(playerId) {
      state.selectedVote = playerId;
      renderInlineVoteCards(container, votePlayers, playerId, onVoteSelect);
      $('#btn-confirm-vote-inline').disabled = false;
    }

    renderInlineVoteCards(container, votePlayers, null, onVoteSelect);

    $('#btn-confirm-vote-inline').disabled = true;
    $('#btn-skip-vote-inline').disabled = false;
    $('#btn-confirm-vote-inline').onclick = () => {
      if (state.selectedVote) {
        state.socket.emit('cast-vote', { targetId: state.selectedVote });
        disableInlineVoteUI();
      }
    };

    $('#btn-skip-vote-inline').onclick = () => {
      state.socket.emit('cast-vote', { targetId: 'skip' });
      disableInlineVoteUI();
    };

    // Show snipe button for imposter in classic mode
    const isImposter = state.myRole === 'imposter';
    const isClassic = state.settings.mode === 'classic';
    const snipeBtn = $('#btn-snipe');
    if (isImposter && isClassic) {
      snipeBtn.style.display = '';
      snipeBtn.onclick = () => showSnipeDialog();
    } else {
      snipeBtn.style.display = 'none';
    }

    updateInlineVoteCount();
  }

  function renderInlineVoteCards(container, players, selectedId, onselect) {
    container.innerHTML = '';
    players.forEach((p) => {
      const card = UI.el('div', 'vote-card-inline' + (p.id === selectedId ? ' selected' : '') + (p.id === state.myId ? ' voted' : ''));
      if (p.id === state.myId) card.style.pointerEvents = 'none';

      const avatar = UI.el('div', 'vci-avatar', (p.name || '?')[0].toUpperCase());
      avatar.style.background = UI.getPlayerColor(p.id);
      const name = UI.el('span', 'vci-name', UI.escapeHtml(p.name));

      card.appendChild(avatar);
      card.appendChild(name);

      if (p.id !== state.myId) {
        card.onclick = () => onselect(p.id);
      }

      container.appendChild(card);
    });
  }

  function disableInlineVoteUI() {
    $('#btn-confirm-vote-inline').disabled = true;
    $('#btn-skip-vote-inline').disabled = true;
    document.querySelectorAll('.vote-card-inline').forEach((c) => { c.style.pointerEvents = 'none'; });
    const snipeBtn = $('#btn-snipe');
    if (snipeBtn) snipeBtn.style.display = 'none';
  }

  function updateInlineVoteCount() {
    const el = $('#vote-count-inline');
    if (!el) return;
    const total = state.players.filter((p) => p.isConnected !== false).length;
    const voted = Object.keys(state.votes).length;
    el.textContent = voted + ' / ' + total + ' voted';
  }

  // ── Snipe (Word Guess during voting) ────────────────────
  function removeSnipeOverlay() {
    document.querySelectorAll('.snipe-overlay').forEach((el) => el.remove());
  }

  function showSnipeDialog(opts) {
    opts = opts || {};
    removeSnipeOverlay();
    const title = opts.title || 'Snipe the Word!';
    const subtitle = opts.subtitle || 'Guess the word to win. You have one attempt.';
    const btnText = opts.btnText || 'Snipe!';
    const emitEvent = opts.emitEvent || 'snipe';
    const overlay = UI.el('div', 'snipe-overlay');
    const inner = UI.el('div', 'snipe-dialog glass');
    inner.innerHTML = '<img src="/logo/draw-mafia-logo-nobg.png" alt="Draw Mafia" class="screen-icon-logo"><h3>' + title + '</h3><p>' + subtitle + '</p>';
    const inputWrap = UI.el('div', 'snipe-input-wrap');
    const input = UI.el('input', 'input snipe-input');
    input.type = 'text';
    input.placeholder = 'Type your guess...';
    input.maxLength = 50;
    input.autocomplete = 'off';
    const submitBtn = UI.el('button', 'btn btn-danger', btnText);
    inputWrap.appendChild(input);
    inputWrap.appendChild(submitBtn);
    inner.appendChild(inputWrap);
    const cancelBtn = UI.el('button', 'btn btn-ghost', 'Cancel');
    inner.appendChild(cancelBtn);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    setTimeout(() => input.focus(), 100);

    function submit() {
      const guess = input.value.trim();
      if (guess) {
        state.socket.emit(emitEvent, { guess });
        overlay.remove();
        submitBtn.disabled = true;
        UI.toast(opts.successToast || 'Submitted!', 'info');
      }
    }

    submitBtn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    cancelBtn.onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  }

  function showWordGuessOverlay(data) {
    AudioEngine.playReveal();
    const isImposter = state.myId === data.imposterId;

    if (isImposter) {
      showSnipeDialog({
        title: 'Guess the Word!',
        subtitle: 'You\'ve been caught! Guess the word to stay in the game. You have one attempt.',
        btnText: 'Guess',
        emitEvent: 'guess-word',
        successToast: 'Word guessed!',
      });
    } else {
      UI.toast('The imposter has been caught! They get to guess the word...', 'info');
    }
  }

  // ── Word Guess (legacy — kept for compatibility) ────────
  function showWordGuessScreen(data) {
    showWordGuessOverlay(data);
  }

  // ── Results ───────────────────────────────────────────────
  function showResults(data) {
    showScreen('results');

    const title = $('#res-title');
    const survived = data.result === 'survived';
    const artistsWin = data.result === 'caught' || data.result === 'imposter-disconnected';
    const wrongVote = data.result === 'wrong-vote';
    if (survived) {
      title.textContent = 'No One Ejected';
      title.className = 'res-title neutral';
    } else if (wrongVote) {
      title.textContent = 'Wrong Person Voted Out!';
      title.className = 'res-title lose';
    } else {
      title.textContent = artistsWin ? 'Artists Win!' : 'Imposter Wins!';
      title.className = 'res-title ' + (artistsWin ? 'win' : 'lose');
    }

    if (survived) AudioEngine.playDing();
    else if (wrongVote) AudioEngine.playLoseBuzzer();
    else if (artistsWin) AudioEngine.playWinFanfare();
    else AudioEngine.playLoseBuzzer();

    const imposterNames = (data.imposters || []).map((id) => {
      const p = state.players.find((pl) => pl.id === id);
      return p ? p.name : id;
    });
    const resImposter = $('#res-imposter');
    if (resImposter) {
      const strong = resImposter.querySelector('strong');
      if (strong) strong.textContent = imposterNames.join(', ');
    }
    const resWord = $('#res-word');
    if (resWord) {
      const strong = resWord.querySelector('strong');
      if (strong) strong.textContent = data.word || '???';
    }

    if (data.imposterWord && state.settings.mode === 'blind') {
      const resBlind = $('#res-blind');
      if (resBlind) {
        resBlind.style.display = '';
        const strong = resBlind.querySelector('strong');
        if (strong) strong.textContent = data.imposterWord;
      }
    } else {
      const resBlind = $('#res-blind');
      if (resBlind) resBlind.style.display = 'none';
    }

    if (data.scores) {
      state.players.forEach((p) => {
        if (data.scores[p.id] !== undefined) p.score = data.scores[p.id];
      });
    }

    const scoreContainer = $('#res-scores');
    scoreContainer.innerHTML = '';
    if (data.roundScores) {
      Object.keys(data.roundScores).forEach((id) => {
        const p = state.players.find((pl) => pl.id === id);
        const name = p ? p.name : id;
        const change = data.roundScores[id];
        const row = UI.el('div', 'res-score-row');
        row.appendChild(UI.el('span', 'rs-name', name));
        row.appendChild(UI.el('span', 'rs-change ' + (change >= 0 ? 'pos' : 'neg'),
          (change >= 0 ? '+' : '') + change));
        scoreContainer.appendChild(row);
      });
    }

    let remaining = 5;
    const isLastRound = data.round >= data.totalRounds;
    const countEl = $('#res-next-count');
    const resNextEl = $('#res-next');
    if (resNextEl) {
      const prefix = isLastRound ? 'Showing final results in ' : 'Returning to lobby in ';
      if (countEl) {
        countEl.textContent = remaining;
        resNextEl.innerHTML = prefix + '<span id="res-next-count">' + remaining + '</span>s...';
      } else {
        resNextEl.textContent = prefix + remaining + 's...';
      }
    }

    clearUITimer();
    state.uiTimerHandle = setInterval(() => {
      remaining--;
      const el = $('#res-next-count');
      if (el) el.textContent = remaining;
      if (remaining <= 0) clearUITimer();
    }, 1000);
  }

  // ── Game Over ─────────────────────────────────────────────
  function showGameOver(data) {
    showScreen('gameover');
    UI.renderScoreboard($('#final-board'), data.finalScores || []);

    const lbSection = $('#leaderboard-section');
    const lbBoard = $('#leaderboard-board');
    if (data.leaderboard && data.leaderboard.length > 0) {
      lbSection.style.display = '';
      UI.renderLeaderboard(lbBoard, data.leaderboard);
    } else {
      lbSection.style.display = 'none';
    }

    const btnAgain = $('#btn-again');
    btnAgain.textContent = 'Play Again';
    btnAgain.disabled = false;
    btnAgain.onclick = () => {
      state.socket.emit('play-again');
      btnAgain.disabled = true;
      btnAgain.textContent = 'Waiting for others...';
    };

    const playAgainStatus = $('#play-again-status');
    if (playAgainStatus) playAgainStatus.textContent = '';

    AudioEngine.playWinFanfare();
  }

  function updatePlayAgainStatus(playAgainPlayers) {
    const statusEl = $('#play-again-status');
    if (!statusEl) return;
    const clicked = playAgainPlayers.length;
    const iClicked = playAgainPlayers.includes(state.myId);
    statusEl.textContent = clicked + ' / ' + state.players.length + ' ready' + (iClicked ? ' (you)' : '');
  }

  // ── Timer ─────────────────────────────────────────────────
  function startTimer(prefix, duration) {
    clearUITimer();
    const fill = document.getElementById(prefix + '-timer-fill');
    const text = document.getElementById(prefix + '-timer-text');
    if (!fill || !text) return;

    state.timerStart = Date.now();
    state.timerDuration = duration * 1000;

    UI.updateTimer(fill, text, 0, state.timerDuration);

    state.uiTimerHandle = setInterval(() => {
      const elapsed = Date.now() - state.timerStart;
      UI.updateTimer(fill, text, elapsed, state.timerDuration);

      const remaining = state.timerDuration - elapsed;
      if (remaining <= 5000 && remaining > 0 && Math.ceil(remaining / 1000) !== Math.ceil((remaining + 100) / 1000)) {
        AudioEngine.playTick();
      }
      if (remaining <= 0) clearUITimer();
    }, 100);
  }

  function clearUITimer() {
    if (state.uiTimerHandle) {
      clearInterval(state.uiTimerHandle);
      state.uiTimerHandle = null;
    }
  }

  // ── State reset ───────────────────────────────────────────
  function resetState() {
    state.myId = null;
    state.roomCode = null;
    state.isHost = false;
    state.players = [];
    state.settings = {};
    state.myRole = null;
    state.myWord = null;
    state.currentPhase = null;
    state.currentTurnId = null;
    state.votes = {};
    state.selectedVote = null;
    state.roomState = 'lobby';
    state.betweenRound = false;
    clearUITimer();
  }

  // ── Wire up UI ────────────────────────────────────────────
  function wireUI() {
    // Home
    $('#btn-create').onclick = () => {
      const name = $('#input-name').value.trim();
      if (!name) { UI.toast('Enter your name', 'error'); return; }
      state.myName = name;
      localStorage.setItem('dm-name', name);
      AudioEngine.init();
      state.socket.emit('create-room', { playerName: name });
    };

    $('#btn-join').onclick = () => {
      const name = $('#input-name').value.trim();
      const code = $('#input-code').value.trim().toUpperCase();
      if (!name) { UI.toast('Enter your name', 'error'); return; }
      if (!code) { UI.toast('Enter room code', 'error'); return; }
      state.myName = name;
      localStorage.setItem('dm-name', name);
      AudioEngine.init();
      state.socket.emit('join-room', { roomCode: code, playerName: name });
    };

    $('#input-code').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-join').click(); };
    $('#input-name').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-create').click(); };

    // Lobby
    $('#btn-copy').onclick = () => {
      if (state.roomCode) {
        navigator.clipboard.writeText(state.roomCode)
          .then(() => UI.toast('Room code copied!', 'success'))
          .catch(() => UI.toast(state.roomCode, 'info'));
      }
    };

    $('#btn-reveal-code').onclick = () => {
      state.codeRevealed = !state.codeRevealed;
      updateLobbyCodeDisplay();
    };

    $('#btn-start').onclick = () => {
      const btn = $('#btn-start');
      if (btn) btn.disabled = true;
      if (state.betweenRound) {
        state.betweenRound = false;
        state.socket.emit('start-next-round');
      } else {
        state.socket.emit('start-game');
      }
    };

    $('#btn-leave').onclick = () => {
      state.socket.emit('leave-room');
      resetState();
      showScreen('home');
    };

    // Chat (lobby)
    const chatLobby = () => {
      const input = $('#chat-in-lobby');
      const msg = input.value.trim();
      if (msg) { state.socket.emit('chat-message', { message: msg }); input.value = ''; }
    };
    $('#btn-chat-lobby').onclick = chatLobby;
    $('#chat-in-lobby').onkeydown = (e) => { if (e.key === 'Enter') chatLobby(); };

    // Chat (game)
    const chatGame = () => {
      const input = $('#chat-in-game');
      const msg = input.value.trim();
      if (msg) { state.socket.emit('chat-message', { message: msg }); input.value = ''; }
    };
    $('#btn-chat-game').onclick = chatGame;
    $('#chat-in-game').onkeydown = (e) => { if (e.key === 'Enter') chatGame(); };

    // Drawing tools
    $('#btn-eraser').onclick = () => DrawCanvas.setTool('eraser');
    $('#btn-undo').onclick = () => DrawCanvas.undoLastStroke();
    $('#btn-done').onclick = () => state.socket.emit('done-drawing');

    $('#pick-color').oninput = (e) => {
      DrawCanvas.setColor(e.target.value);
      document.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('active'));
    };

    document.querySelectorAll('.btn-size').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('.btn-size').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        DrawCanvas.setSize(Number(btn.dataset.size));
      };
    });

    DrawCanvas.onStroke((stroke) => state.socket.emit('draw', stroke));

    // Mute
    $('#btn-mute').onclick = () => {
      AudioEngine.init();
      const muted = AudioEngine.toggleMute();
      $('#btn-mute').textContent = muted ? '🔇' : '🔊';
      localStorage.setItem('dm-muted', muted);
    };

    if (localStorage.getItem('dm-muted') === 'true') {
      AudioEngine.toggleMute();
      $('#btn-mute').textContent = '🔇';
    }

    window.addEventListener('beforeunload', (e) => {
      if (state.roomState === 'playing') { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    UI.initParticles();
    DrawCanvas.init(
      document.getElementById('draw-canvas'),
      document.getElementById('disc-canvas')
    );
    connectSocket();
    wireUI();
    const savedName = localStorage.getItem('dm-name');
    if (savedName) $('#input-name').value = savedName;
    showScreen('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
