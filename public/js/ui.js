/* ═══════════════════════════════════════════════════════════
   UI HELPERS — DOM rendering & manipulation
   ═══════════════════════════════════════════════════════════ */

const UI = (() => {
  const PLAYER_COLORS = [
    '#ff4060', '#ff8c00', '#ffcc00', '#00e87b', '#00cfff',
    '#7c5cff', '#ff69b4', '#40e0d0', '#ff6347', '#9370db',
    '#3cb371', '#ffa07a',
  ];

  function getPlayerColor(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0;
    }
    return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length];
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function renderPlayerList(container, players, opts) {
    container.innerHTML = '';
    const { currentTurnId, myId, isHost, onKick } = opts || {};

    players.forEach((p) => {
      const classNames = ['player-item'];
      if (p.isConnected === false) classNames.push('disconnected');
      if (p.id === currentTurnId) classNames.push('active-turn');
      if (p.ready) classNames.push('ready');
      const item = el('div', classNames.join(' '));
      const avatar = el('div', 'player-avatar', (p.name || '?')[0].toUpperCase());
      avatar.style.background = getPlayerColor(p.id);

      const name = el('span', 'player-name', escapeHtml(p.name));
      const tags = el('span');

      if (p.id === myId) {
        tags.appendChild(el('span', 'player-tag tag-you', 'You'));
      }
      if (p.isHost) {
        tags.appendChild(el('span', 'player-tag tag-host', 'Host'));
      }
      if (p.isConnected === false) {
        tags.appendChild(el('span', 'player-tag tag-disconnected', 'DC'));
      }
      if (p.ready && !p.isHost) {
        tags.appendChild(el('span', 'player-tag tag-ready', 'Ready'));
      }

      item.appendChild(avatar);
      item.appendChild(name);
      item.appendChild(tags);

      if (isHost && p.id !== myId && p.isConnected !== false && onKick) {
        const kickBtn = el('button', 'btn-kick', 'Kick');
        kickBtn.onclick = (e) => { e.stopPropagation(); onKick(p.id); };
        item.appendChild(kickBtn);
      }

      container.appendChild(item);
    });
  }

  function renderChat(container, message) {
    const msgEl = el('div', 'chat-msg');
    if (message.system) {
      msgEl.classList.add('system');
      msgEl.textContent = message.message;
    } else {
      const nameSpan = el('span', 'msg-name', escapeHtml(message.playerName) + ':');
      msgEl.appendChild(nameSpan);
      msgEl.appendChild(document.createTextNode(' ' + escapeHtml(message.message)));
    }
    const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 40;
    container.appendChild(msgEl);
    if (nearBottom) container.scrollTop = container.scrollHeight;
  }

  function renderSettings(container, settings, isHost, onchange) {
    container.innerHTML = '';
    const defs = [
      { key: 'mode', label: 'Game Mode', type: 'select', options: [
        { value: 'classic', label: 'Classic' },
        { value: 'blind', label: 'Blind Imposter' },
      ]},
      { key: 'drawTime', label: 'Draw Time (s)', type: 'range', min: 5, max: 30, step: 1 },
      { key: 'drawingPasses', label: 'Drawing Passes', type: 'select', options: [
        { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' },
      ]},
      { key: 'drawingVisibility', label: 'Drawing Visibility', type: 'select', options: [
        { value: 'live', label: 'Live' }, { value: 'reveal', label: 'Reveal After Turn' },
      ]},
      { key: 'persistDrawings', label: 'Persist Drawings Between Rounds', type: 'checkbox' },
      { key: 'discussionTime', label: 'Discussion (s)', type: 'range', min: 10, max: 180, step: 10 },
      { key: 'votingTime', label: 'Voting (s)', type: 'range', min: 15, max: 90, step: 5 },
      { key: 'totalRounds', label: 'Max Rounds', type: 'select', options: [
        { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' },
        { value: 5, label: '5' }, { value: 10, label: '10' },
      ]},
      { key: 'wordCategory', label: 'Word Category', type: 'select', options: [
        { value: 'all', label: 'All' }, { value: 'animals', label: 'Animals' },
        { value: 'food', label: 'Food' }, { value: 'objects', label: 'Objects' },
        { value: 'places', label: 'Places' }, { value: 'actions', label: 'Actions' },
      ]},
      { key: 'imposterCount', label: 'Imposters', type: 'select', options: [
        { value: 1, label: '1' }, { value: 2, label: '2' },
      ]},
    ];

    defs.forEach((d) => {
      const item = el('div', 'setting-item');
      const label = el('label', '', d.label);
      item.appendChild(label);

      if (d.type === 'select') {
        const sel = el('select');
        sel.disabled = !isHost;
        d.options.forEach((o) => {
          const opt = el('option', '', o.label);
          opt.value = o.value;
          if (String(settings[d.key]) === String(o.value)) opt.selected = true;
          sel.appendChild(opt);
        });
        if (isHost) {
          sel.onchange = () => onchange({ [d.key]: sel.value });
        }
        item.appendChild(sel);
      } else if (d.type === 'range') {
        const valSpan = el('span', 'setting-val', settings[d.key]);
        const range = el('input');
        range.type = 'range';
        range.min = d.min;
        range.max = d.max;
        range.step = d.step;
        range.value = settings[d.key];
        range.disabled = !isHost;
        if (isHost) {
          range.oninput = () => {
            valSpan.textContent = range.value;
          };
          range.onchange = () => {
            onchange({ [d.key]: Number(range.value) });
          };
        }
        item.appendChild(valSpan);
        item.appendChild(range);
      } else if (d.type === 'checkbox') {
        const wrap = el('div', 'setting-checkbox-wrap');
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !!settings[d.key];
        checkbox.disabled = !isHost;
        if (isHost) {
          checkbox.onchange = () => {
            onchange({ [d.key]: checkbox.checked });
          };
        }
        wrap.appendChild(checkbox);
        item.appendChild(wrap);
      }

      container.appendChild(item);
    });
  }



  function renderScoreboard(container, finalScores) {
    container.innerHTML = '';
    const medals = ['🏆', '🥈', '🥉'];
    finalScores.forEach((entry, i) => {
      const row = el('div', 'final-row' + (i === 0 ? ' rank-1' : ''));
      const rank = el('span', 'final-rank', medals[i] || '#' + (i + 1));
      const name = el('span', 'final-name', escapeHtml(entry.playerName));
      const score = el('span', 'final-score', entry.score);
      row.appendChild(rank);
      row.appendChild(name);
      row.appendChild(score);
      container.appendChild(row);
    });
  }

  function renderLeaderboard(container, entries) {
    container.innerHTML = '';
    if (!entries || entries.length === 0) {
      container.innerHTML = '<p style="color:var(--muted);text-align:center;">No leaderboard data yet</p>';
      return;
    }
    const title = el('h3', 'leaderboard-title', 'All-Time Leaderboard');
    container.appendChild(title);
    const medals = ['🏆', '🥈', '🥉'];
    entries.forEach((entry, i) => {
      const row = el('div', 'final-row lb-row' + (i === 0 ? ' rank-1' : ''));
      const rank = el('span', 'final-rank', medals[i] || '#' + (i + 1));
      const name = el('span', 'final-name', escapeHtml(entry.name));
      const score = el('span', 'final-score', entry.score);
      row.appendChild(rank);
      row.appendChild(name);
      row.appendChild(score);
      container.appendChild(row);
    });
  }

  function updateTimer(fillEl, textEl, elapsed, total) {
    if (!fillEl || !textEl || total <= 0) return;
    const remaining = Math.max(0, total - elapsed);
    const pct = (remaining / total) * 100;
    fillEl.style.width = pct + '%';
    textEl.textContent = Math.ceil(remaining / 1000) + 's';
    fillEl.classList.remove('warn', 'danger');
    if (pct < 20) fillEl.classList.add('danger');
    else if (pct < 50) fillEl.classList.add('warn');
  }

  function toast(message, type) {
    const container = document.getElementById('toasts');
    const t = el('div', 'toast ' + (type || 'info'), escapeHtml(message));
    container.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 3000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function initParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    for (let i = 0; i < 30; i++) {
      const p = el('div', 'particle');
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = (4 + Math.random() * 6) + 's';
      p.style.animationDelay = Math.random() * 5 + 's';
      const colors = ['var(--primary)', 'var(--accent)', 'var(--secondary)'];
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      container.appendChild(p);
    }
  }

  return {
    getPlayerColor,
    $, $$,
    el,
    renderPlayerList,
    renderChat,
    renderSettings,

    renderScoreboard,
    renderLeaderboard,
    updateTimer,
    toast,
    escapeHtml,
    initParticles,
  };
})();
