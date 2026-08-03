/* ═══════════════════════════════════════════════════════════
   APP.JS — Main controller, socket wiring, state management
   ═══════════════════════════════════════════════════════════ */

(() => {
  const RECONNECT_KEY = 'drawmafia_reconnect';

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
    myWordLength: 0,
    currentPhase: null,
    currentTurnId: null,
    votes: {},
    selectedVote: null,
    uiTimerHandle: null,
    timerStart: 0,
    timerDuration: 0,
    codeRevealed: true,
    reconnectToken: null,
    lastGameOutcome: null,
    announceTimer: null,
  };

  const $ = (s) => document.querySelector(s);

  // ── Socket ────────────────────────────────────────────────
  function connectSocket() {
    state.socket = io({ transports: ['websocket', 'polling'] });

    state.socket.on('connect', () => {
      console.log('Connected:', state.socket.id);
      UI.toast('Connected', 'success');
      try {
        const stored = JSON.parse(localStorage.getItem(RECONNECT_KEY));
        if (stored && stored.token && !state.roomCode) {
          state.socket.emit('reconnect-game', { reconnectToken: stored.token });
        }
      } catch {}
    });

    state.socket.on('disconnect', () => {
      UI.toast('Connection lost. Reconnecting...', 'error');
    });

    state.socket.on('reconnect', () => {
      UI.toast('Reconnected!', 'success');
      if (state.reconnectToken && state.roomCode) {
        state.socket.emit('reconnect-game', { reconnectToken: state.reconnectToken });
      } else {
        try {
          const stored = JSON.parse(localStorage.getItem(RECONNECT_KEY));
          if (stored && stored.token) {
            state.socket.emit('reconnect-game', { reconnectToken: stored.token });
          }
        } catch {}
      }
    });

    state.socket.on('error', (data) => {
      UI.toast(data.message || 'Error', 'error');
      const createBtn = $('#btn-create');
      const joinBtn = $('#btn-join');
      if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Create Room'; }
      if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Join'; }
    });

    // ── Room events ──
    state.socket.on('room-created', (data) => {
      const createBtn = $('#btn-create');
      if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Create Room'; }
      state.roomCode = data.roomCode;
      state.myId = data.playerId;
      state.isHost = true;
      state.codeRevealed = false;
      state.reconnectToken = data.reconnectToken;
      try { localStorage.setItem(RECONNECT_KEY, JSON.stringify({ token: data.reconnectToken, roomCode: data.roomCode })); } catch {}
      applyRoomState(data.room);
      showScreen('lobby');
      updateLobbyCodeDisplay();
    });

    state.socket.on('room-joined', (data) => {
      const joinBtn = $('#btn-join');
      if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Join'; }
      state.roomCode = data.roomCode;
      state.myId = data.playerId;
      state.codeRevealed = false;
      state.reconnectToken = data.reconnectToken;
      try { localStorage.setItem(RECONNECT_KEY, JSON.stringify({ token: data.reconnectToken, roomCode: data.roomCode })); } catch {}
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
      state.myWordLength = data.wordLength || 0;
    });

    state.socket.on('round-started', (data) => {
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
          const eo = $('#ejected-overlay');
          if (eo) eo.style.display = 'none';
          if (!data.persistDrawings) {
            DrawCanvas.clearCanvas();
          }
          DrawCanvas.setLiveStreaming(data.drawingVisibility === 'live');
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
      DrawCanvas.handleDrawEnd({});
      const drawTools = $('#draw-tools');
      if (drawTools) drawTools.style.display = 'none';
    });

    state.socket.on('stroke', (data) => DrawCanvas.addRemoteStroke(data));

    state.socket.on('turn-strokes', (data) => DrawCanvas.revealTurnStrokes(data));

    state.socket.on('draw-start', (data) => DrawCanvas.handleDrawStart(data));
    state.socket.on('draw-points', (data) => DrawCanvas.handleDrawPoints(data));
    state.socket.on('draw-end', (data) => DrawCanvas.handleDrawEnd(data));
    state.socket.on('stroke-undone', (data) => DrawCanvas.handleStrokeUndone(data));

    state.socket.on('canvas-strokes', (strokes) => {
      if (strokes && Array.isArray(strokes)) {
        strokes.forEach((s) => DrawCanvas.addRemoteStroke(s));
      }
    });

    state.socket.on('chat-message', (data) => {
      AudioEngine.playMessage();
      ['chat-lobby', 'chat-game', 'chat-game-mobile'].forEach((id) => {
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

    state.socket.on('ejected', (data) => {
      const overlay = $('#ejected-overlay');
      const msg = $('#ejected-msg');
      if (overlay) overlay.style.display = '';
      if (msg) msg.textContent = data.reason || 'You were voted out.';
      DrawCanvas.disableDrawing();
      hideAllBottomBars();
    });

    state.socket.on('round-results', (data) => showResults(data));

    state.socket.on('snipe-result', (data) => {
      const snipeBtn = $('#btn-snipe');
      if (snipeBtn) snipeBtn.style.display = 'none';
      if (data.correct) {
        UI.toast('The imposter sniped the word!', 'success');
        AudioEngine.playWinFanfare();
      } else {
        UI.toast('The imposter missed the snipe!', 'error');
        AudioEngine.playLoseBuzzer();
      }
    });

    state.socket.on('game-over', (data) => showAnnounce(data));

    state.socket.on('returned-to-lobby', (data) => {
      state.roomState = 'lobby';
      state.myRole = null;
      state.myWord = null;
      state.currentPhase = null;
      state.currentTurnId = null;
      state.votes = {};
      state.selectedVote = null;
      const eo = $('#ejected-overlay');
      if (eo) eo.style.display = 'none';
      if (playAgainTimerInterval) { clearInterval(playAgainTimerInterval); playAgainTimerInterval = null; }
      if (state.announceTimer) { clearTimeout(state.announceTimer); state.announceTimer = null; }
      DrawCanvas.clearCanvas();
      clearUITimer();
      if (data && data.room) applyRoomState(data.room);
      showScreen('lobby');
      updateLobbyPlayers();
      renderLobbySettings();
      updateStartButton();
    });

    state.socket.on('player-reconnected', (data) => {
      if (data.room) applyRoomState(data.room);
      UI.toast('A player reconnected', 'info');
    });

    state.socket.on('reconnected', (data) => {
      state.myId = data.playerId;
      state.roomCode = data.roomCode;
      state.reconnectToken = data.reconnectToken;
      applyRoomState(data.room);

      if (data.gameState) {
        state.roomState = 'playing';
        state.currentPhase = data.gameState.phase;
        if (data.gameState.phase === 'role-reveal') {
          showScreen('role-reveal');
        } else {
          showScreen('game');
          setupGameScreen();
        }
      } else {
        showScreen('lobby');
      }

      UI.toast('Reconnected successfully', 'success');
    });

    state.socket.on('removed-from-room', (data) => {
      if (playAgainTimerInterval) { clearInterval(playAgainTimerInterval); playAgainTimerInterval = null; }
      UI.toast(data.reason || 'You were removed from the room', 'error');
      resetState();
      showScreen('home');
    });

    state.socket.on('play-again-updated', (data) => {
      updatePlayAgainStatus(data.playAgainPlayers || [], data.timerDeadline);
      startPlayAgainTimer(data.playAgainPlayers || [], data.timerDeadline);
    });

    state.socket.on('player-disconnected', (data) => {
      if (data && data.playerId) {
        const p = state.players.find((pl) => pl.id === data.playerId);
        UI.toast((p ? p.name : 'A player') + ' disconnected', 'info');
      } else {
        UI.toast('A player disconnected', 'info');
      }
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
    const readyBtn = $('#btn-ready');
    if (readyBtn) {
      if (state.isHost) {
        readyBtn.style.display = 'none';
      } else {
        readyBtn.style.display = '';
        const me = state.players.find((p) => p.id === state.myId);
        readyBtn.textContent = me && me.ready ? '✓ Ready' : 'Ready';
        readyBtn.className = 'btn ' + (me && me.ready ? 'btn-primary' : 'btn-secondary');
      }
    }
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
    const nonHostPlayers = state.players.filter((p) => !p.isHost && p.isConnected !== false);
    const readyCount = nonHostPlayers.filter((p) => p.ready).length;
    const allReady = nonHostPlayers.length > 0 && readyCount === nonHostPlayers.length;

    const canStart = state.isHost && state.players.length >= minPlayers;
    btn.disabled = !canStart || (nonHostPlayers.length > 0 && !allReady);
    if (canStart && nonHostPlayers.length > 0) {
      btn.textContent = 'Start Game (' + readyCount + '/' + nonHostPlayers.length + ' ready)';
    } else if (canStart) {
      btn.textContent = 'Start Game';
    } else if (state.isHost) {
      btn.textContent = 'Start Game (' + state.players.length + '/' + minPlayers + ' min)';
    } else {
      btn.textContent = 'Waiting for host...';
    }
  }

  function renderLobbySettings() {
    const section = $('#settings-section');
    const container = $('#settings-controls');
    if (!section || !container) return;
    section.style.display = state.isHost ? '' : 'none';
    UI.renderSettings(container, state.settings, state.isHost, (changes) => {
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

    const catEl = $('#reveal-category');
    if (catEl && data.category && data.category !== 'all') {
      catEl.textContent = 'Category: ' + data.category;
      catEl.style.display = '';
    } else if (catEl) {
      catEl.style.display = 'none';
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
      const len = state.myWordLength || 0;
      const underscores = Array(len).fill('_').join(' ');
      wordBar.innerHTML = underscores + ' <sup class="word-length">(' + len + ')</sup>';
    } else {
      wordBar.textContent = state.myWord || '';
    }
  }

  function updateGameTurn(data) {
    updateGamePlayerList();
    const banner = $('#turn-banner');
    const bannerText = $('#turn-banner-text');

    const player = state.players.find((p) => p.id === data.playerId);
    const playerName = player ? player.name : '???';

    banner.style.display = '';
    if (data.playerId === state.myId) {
      bannerText.textContent = 'Your Turn — you are drawing!';
      DrawCanvas.enableDrawing();
      $('#draw-tools').style.display = '';
      AudioEngine.playDing();
    } else {
      DrawCanvas.disableDrawing();
      if (state.currentPhase === 'drawing') $('#draw-tools').style.display = 'none';
      bannerText.textContent = playerName + ' is drawing now';
    }
  }

  function updateGamePlayerList() {
    ['g-players', 'g-players-mobile'].forEach((id) => {
      const container = document.getElementById(id);
      if (!container) return;
      UI.renderPlayerList(container, state.players, {
        currentTurnId: state.currentTurnId,
        myId: state.myId,
        isHost: false,
      });
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
        UI.toast('Vote cast! Waiting for others...', 'info');
        disableInlineVoteUI();
      }
    };

    $('#btn-skip-vote-inline').onclick = () => {
      state.socket.emit('cast-vote', { targetId: 'skip' });
      UI.toast('Vote cast! Waiting for others...', 'info');
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
    const total = state.players.filter((p) => p.isConnected === true).length;
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
    } else if (data.result === 'caught' && data.wordGuessed === false) {
      title.textContent = 'Imposter Failed to Guess!';
      title.className = 'res-title win';
    } else if (data.result === 'word-guessed') {
      title.textContent = 'Imposter Guessed the Word!';
      title.className = 'res-title lose';
    } else {
      title.textContent = artistsWin ? 'Artists Win!' : 'Imposter Wins!';
      title.className = 'res-title ' + (artistsWin ? 'win' : 'lose');
    }

    if (!data.gameOver) {
      if (survived) AudioEngine.playDing();
      else if (wrongVote) AudioEngine.playLoseBuzzer();
      else if (artistsWin) AudioEngine.playWinFanfare();
      else AudioEngine.playLoseBuzzer();
    }

    if (data.gameOver) {
      state.lastGameOutcome = {
        winner: data.winner || null,
        result: data.result,
        viaSnipe: data.viaSnipe === true,
      };
    } else {
      state.lastGameOutcome = null;
    }

    const resSnipeNote = $('#res-snipe-note');
    if (resSnipeNote) {
      resSnipeNote.style.display = data.snipeMissed ? '' : 'none';
    }

    const imposterNames = (data.imposters || []).map((id) => {
      const p = state.players.find((pl) => pl.id === id);
      return p ? p.name : id;
    });
    const resImposter = $('#res-imposter');
    if (data.gameOver) {
      if (resImposter) {
        const strong = resImposter.querySelector('strong');
        if (strong) strong.textContent = imposterNames.join(', ');
      }
    } else {
      if (resImposter) resImposter.style.display = 'none';
    }
    const resWord = $('#res-word');
    if (data.gameOver) {
      if (resWord) {
        const strong = resWord.querySelector('strong');
        if (strong) strong.textContent = data.word || '???';
      }
    } else {
      if (resWord) resWord.style.display = 'none';
    }

    if (data.gameOver && data.imposterWord && state.settings.mode === 'blind') {
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

    // ── Vote breakdown ──
    const resVotesEl = $('#res-votes');
    const votesList = $('#res-votes-list');
    if (resVotesEl && votesList && data.votes && Object.keys(data.votes).length > 0) {
      votesList.innerHTML = '';
      Object.keys(data.votes).forEach((voterId) => {
        const targetId = data.votes[voterId];
        const voter = state.players.find((p) => p.id === voterId);
        const target = state.players.find((p) => p.id === targetId);
        const row = UI.el('div', 'res-vote-row');
        const voterSpan = UI.el('span', 'voter', voter ? voter.name : voterId);
        let targetSpan;
        if (targetId === '__skip__') {
          targetSpan = UI.el('span', 'target skip', 'Skipped');
        } else {
          targetSpan = UI.el('span', 'target', target ? target.name : targetId);
        }
        row.appendChild(voterSpan);
        row.appendChild(targetSpan);
        votesList.appendChild(row);
      });
      resVotesEl.style.display = '';
    } else if (resVotesEl) {
      resVotesEl.style.display = 'none';
    }

    const scoreContainer = $('#res-scores');
    scoreContainer.innerHTML = '';
    if (data.gameOver && data.roundScores) {
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

    const transitionDelay = data.transitionDelay || 5;
    let remaining = transitionDelay;
    const countEl = $('#res-next-count');
    const resNextEl = $('#res-next');
    if (resNextEl) {
      const prefix = data.gameOver ? 'Game Over in ' : 'Next round in ';
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

  // ── Game End Announce ─────────────────────────────────────
  function showAnnounce(data) {
    if (state.announceTimer) {
      clearTimeout(state.announceTimer);
      state.announceTimer = null;
    }

    const outcome = state.lastGameOutcome;
    if (!outcome || !outcome.winner) {
      showGameOver(data, true);
      return;
    }

    const artistsWon = outcome.winner === 'artists';
    showScreen('announce');

    const titleEl = $('#announce-title');
    const reasonEl = $('#announce-reason');
    titleEl.textContent = artistsWon ? 'Artists Won!' : 'Imposter Won!';
    titleEl.className = 'announce-title ' + (artistsWon ? 'win' : 'lose');

    let reason = 'The game is over!';
    switch (outcome.result) {
      case 'caught':
        reason = 'Caught the imposter!';
        break;
      case 'word-guessed':
        reason = outcome.viaSnipe
          ? 'The imposter sniped the word!'
          : 'The imposter guessed the word!';
        break;
      case 'wrong-vote':
        reason = 'An artist was voted out!';
        break;
      case 'imposter-disconnected':
        reason = 'The imposter disconnected!';
        break;
      case 'survived':
        reason = 'The imposter survived all rounds!';
        break;
      default:
        reason = 'The game is over!';
    }
    reasonEl.textContent = reason;

    AudioEngine.playWinFanfare();

    state.announceTimer = setTimeout(() => {
      state.announceTimer = null;
      showGameOver(data, true);
    }, 4000);
  }

  // ── Game Over ─────────────────────────────────────────────
  function showGameOver(data, skipAudio) {
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

    if (!skipAudio) AudioEngine.playWinFanfare();
  }

  let playAgainTimerInterval = null;

  function updatePlayAgainStatus(playAgainPlayers, timerDeadline) {
    const statusEl = $('#play-again-status');
    if (!statusEl) return;
    const clicked = playAgainPlayers.length;
    const iClicked = playAgainPlayers.includes(state.myId);
    let text = clicked + ' / ' + state.players.length + ' ready' + (iClicked ? ' (you)' : '');
    if (timerDeadline) {
      const remaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
      if (remaining > 0) text += ' — auto-start in ' + remaining + 's';
      else text += ' — starting...';
    }
    statusEl.textContent = text;
  }

  function startPlayAgainTimer(playAgainPlayers, timerDeadline) {
    if (playAgainTimerInterval) clearInterval(playAgainTimerInterval);
    if (!timerDeadline) return;
    playAgainTimerInterval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
      const statusEl = $('#play-again-status');
      if (statusEl) {
        const clicked = (playAgainPlayers || []).length;
        const iClicked = playAgainPlayers && playAgainPlayers.includes(state.myId);
        let text = clicked + ' / ' + state.players.length + ' ready' + (iClicked ? ' (you)' : '');
        if (remaining > 0) text += ' — auto-start in ' + remaining + 's';
        else text += ' — starting...';
        statusEl.textContent = text;
      }
      if (remaining <= 0 && playAgainTimerInterval) {
        clearInterval(playAgainTimerInterval);
        playAgainTimerInterval = null;
      }
    }, 1000);
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
      if (remaining <= 0) {
        clearUITimer();
        DrawCanvas.flushCurrentStroke();
      }
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
    state.myWordLength = 0;
    state.currentPhase = null;
    state.currentTurnId = null;
    state.votes = {};
    state.selectedVote = null;
    state.roomState = 'lobby';
    state.reconnectToken = null;
    state.codeRevealed = true;
    state.lastGameOutcome = null;
    if (state.announceTimer) { clearTimeout(state.announceTimer); state.announceTimer = null; }
    try { localStorage.removeItem(RECONNECT_KEY); } catch {}
    clearUITimer();
  }

  // ── Wire up UI ────────────────────────────────────────────
  function wireUI() {
    // Home
    $('#btn-create').onclick = () => {
      const name = $('#input-name').value.trim();
      if (!name) { UI.toast('Enter your name', 'error'); return; }
      state.myName = name;
      localStorage.setItem('drawmafia_name', name);
      AudioEngine.init();
      const btn = $('#btn-create');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      state.socket.emit('create-room', { playerName: name });
    };

    $('#btn-join').onclick = () => {
      const name = $('#input-name').value.trim();
      const code = $('#input-code').value.trim();
      if (!name) { UI.toast('Enter your name', 'error'); return; }
      if (!code) { UI.toast('Enter room code', 'error'); return; }
      state.myName = name;
      localStorage.setItem('drawmafia_name', name);
      AudioEngine.init();
      const btn = $('#btn-join');
      btn.disabled = true;
      btn.textContent = 'Joining...';
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
      state.socket.emit('start-game');
    };

    $('#btn-ready').onclick = () => {
      state.socket.emit('toggle-ready');
    };

    $('#btn-leave').onclick = () => {
      if (state.players.length > 1) {
        if (!confirm('Are you sure you want to leave the room?')) return;
      }
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
    const chatGameFn = () => {
      const input = $('#chat-in-game');
      const msg = input.value.trim();
      if (msg) { state.socket.emit('chat-message', { message: msg }); input.value = ''; }
    };
    $('#btn-chat-game').onclick = chatGameFn;
    $('#chat-in-game').onkeydown = (e) => { if (e.key === 'Enter') chatGameFn(); };

    // Mobile chat (game)
    const chatGameMobile = () => {
      const input = $('#chat-in-game-mobile');
      const msg = input.value.trim();
      if (msg) { state.socket.emit('chat-message', { message: msg }); input.value = ''; }
    };
    $('#btn-chat-game-mobile').onclick = chatGameMobile;
    $('#chat-in-game-mobile').onkeydown = (e) => { if (e.key === 'Enter') chatGameMobile(); };

    // Mobile overlay toggles
    $('#btn-mobile-players').onclick = () => {
      const overlay = $('#mobile-players-overlay');
      if (overlay) overlay.style.display = overlay.style.display === 'none' ? '' : 'none';
    };
    $('#btn-close-mobile-players').onclick = () => {
      const overlay = $('#mobile-players-overlay');
      if (overlay) overlay.style.display = 'none';
    };
    $('#btn-mobile-chat').onclick = () => {
      const overlay = $('#mobile-chat-overlay');
      if (overlay) overlay.style.display = overlay.style.display === 'none' ? '' : 'none';
    };
    $('#btn-close-mobile-chat').onclick = () => {
      const overlay = $('#mobile-chat-overlay');
      if (overlay) overlay.style.display = 'none';
    };

    // Drawing tools
    $('#btn-eraser').onclick = () => DrawCanvas.setTool('eraser');
    $('#btn-undo').onclick = () => {
      DrawCanvas.undoLastStroke();
      state.socket.emit('undo-stroke');
    };
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
    DrawCanvas.onDrawStart((data) => state.socket.emit('draw-start', data));
    DrawCanvas.onDrawPoints((data) => state.socket.emit('draw-points', data));
    DrawCanvas.onDrawEnd((data) => state.socket.emit('draw-end', data));

    // Mute
    $('#btn-mute').onclick = () => {
      AudioEngine.init();
      const muted = AudioEngine.toggleMute();
      $('#btn-mute').textContent = muted ? '🔇' : '🔊';
      localStorage.setItem('drawmafia_muted', muted);
    };

    if (localStorage.getItem('drawmafia_muted') === 'true') {
      AudioEngine.toggleMute();
      $('#btn-mute').textContent = '🔇';
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && state.currentScreen === 'game') {
        const input = $('#chat-in-game');
        if (input && document.activeElement !== input) {
          e.preventDefault();
          input.focus();
        }
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.roomState === 'playing') { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    UI.initParticles();
    DrawCanvas.init(document.getElementById('draw-canvas'));
    connectSocket();
    wireUI();
    const savedName = localStorage.getItem('drawmafia_name');
    if (savedName) $('#input-name').value = savedName;
    showScreen('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
