/* ═══════════════════════════════════════════════════════════
   AUDIO ENGINE — Web Audio API (zero external files)
   ═══════════════════════════════════════════════════════════ */

const AudioEngine = (() => {
  let ctx = null;
  let masterGain = null;
  let muted = false;
  let volume = 0.5;

  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  function ensureCtx() {
    if (!ctx) init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function playTone(freq, duration, type, vol) {
    ensureCtx();
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime((vol || 0.3) * volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  function playNoise(duration, filterFreq, vol) {
    ensureCtx();
    if (!ctx || muted) return;
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 1000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime((vol || 0.15) * volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start(ctx.currentTime);
  }

  return {
    init,

    playTick() {
      playTone(800, 0.05, 'sine', 0.2);
    },

    playDing() {
      ensureCtx();
      if (!ctx || muted) return;
      playTone(523, 0.2, 'sine', 0.3);
      setTimeout(() => playTone(659, 0.2, 'sine', 0.2), 50);
    },

    playWhoosh() {
      playNoise(0.3, 2000, 0.15);
    },

    playReveal() {
      ensureCtx();
      if (!ctx || muted) return;
      const now = ctx.currentTime;
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25 * volume, now + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + i * 0.05);
        osc.stop(now + 0.8);
      });
    },

    playVoteDrum() {
      playTone(100, 0.15, 'sine', 0.4);
    },

    playWinFanfare() {
      ensureCtx();
      if (!ctx || muted) return;
      const notes = [523, 659, 784, 1047];
      notes.forEach((freq, i) => {
        setTimeout(() => playTone(freq, 0.25, 'sine', 0.3), i * 150);
      });
    },

    playLoseBuzzer() {
      ensureCtx();
      if (!ctx || muted) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.2 * volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    },

    playMessage() {
      playTone(1000, 0.03, 'sine', 0.1);
    },

    toggleMute() {
      muted = !muted;
      return muted;
    },

    isMuted() {
      return muted;
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (masterGain) masterGain.gain.value = volume;
    },
  };
})();
