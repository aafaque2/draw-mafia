// ─── Timing ─────────────────────────────────────────────────
const TIMING = {
  ROLE_REVEAL_DURATION: 4000,
  ROUND_TRANSITION: 5000,
  WORD_GUESS_DURATION: 15000,
  PLAY_AGAIN_WAIT: 30000,
  ROOM_CLEANUP_INTERVAL: 60000,
  DRAW_GRACE_PERIOD: 1000,
};

// ─── Limits ─────────────────────────────────────────────────
const LIMITS = {
  PLAYER_NAME_MAX: 20,
  CHAT_MESSAGE_MAX: 200,
  GUESS_MAX: 50,
  CANVAS_STROKES_MAX: 2000,
  TURN_STROKES_MAX: 500,
  DRAW_POINTS_MAX: 100,
  STROKE_POINTS_MAX: 500,
  PERSISTENT_SCORES_MAX: 5000,
  CHAT_HISTORY_MAX: 200,
};

// ─── Rate Limiting ──────────────────────────────────────────
const RATE_LIMIT = {
  CHAT_WINDOW_MS: 1000,
  CHAT_MAX: 3,
  DRAW_WINDOW_MS: 1000,
  DRAW_MAX: 60,
  CREATE_ROOM_WINDOW_MS: 60000,
  CREATE_ROOM_MAX: 5,
  VOTE_WINDOW_MS: 1000,
  VOTE_MAX: 3,
};

// ─── Ranges ─────────────────────────────────────────────────
const SETTINGS_RANGES = {
  maxPlayers: { min: 3, max: 12 },
  drawTime: { min: 5, max: 30 },
  drawingPasses: { min: 1, max: 3 },
  discussionTime: { min: 10, max: 180 },
  votingTime: { min: 15, max: 90 },
  totalRounds: { min: 1, max: 10 },
  imposterCount: { min: 1, max: 2 },
};

const VALID_MODES = ['classic', 'blind'];
const VALID_VISIBILITY = ['live', 'reveal'];
const VALID_CATEGORIES = ['all', 'animals', 'food', 'objects', 'places', 'actions'];
const PLAYER_COLORS = [
  '#ff4060', '#ff8c00', '#ffcc00', '#00e87b', '#00cfff',
  '#7c5cff', '#ff69b4', '#40e0d0', '#ff6347', '#9370db',
  '#3cb371', '#ffa07a',
];

module.exports = {
  TIMING,
  LIMITS,
  RATE_LIMIT,
  SETTINGS_RANGES,
  VALID_MODES,
  VALID_VISIBILITY,
  VALID_CATEGORIES,
  PLAYER_COLORS,
};
