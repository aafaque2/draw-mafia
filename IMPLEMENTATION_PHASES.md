# Draw Mafia — Implementation Phases

> Complete build roadmap. Each phase is self-contained with clear inputs, outputs, and verification.

---

## Phase 1: Project Scaffold & Server Bootstrap
> **Goal**: Get a Node.js server running that serves a blank page via Socket.IO.

### Files

#### 1.1 `package.json`
```
- name: "draw-mafia"
- scripts: { "start": "node server.js", "dev": "nodemon server.js" }
- dependencies: express, socket.io
- devDependencies: nodemon
```

#### 1.2 `server.js`
```
- Create Express app
- Serve static files from /public
- Attach Socket.IO to HTTP server
- Import and call setupSocket(io) from src/SocketHandler.js
- Listen on process.env.PORT || 3000
- Console log: "Draw Mafia server running on port XXXX"
```

#### 1.3 `src/SocketHandler.js` (stub)
```
- Export setupSocket(io) function
- On 'connection': log "Player connected: {socket.id}"
- On 'disconnect': log "Player disconnected: {socket.id}"
```

#### 1.4 `public/index.html` (minimal)
```
- Basic HTML5 boilerplate
- Load Socket.IO client from /socket.io/socket.io.js
- Load css/style.css, js/app.js
- Single <div id="app"> with "Draw Mafia" heading
- Script: connect to socket, log "Connected to server"
```

#### 1.5 `public/css/style.css` (stub)
```
- CSS reset (box-sizing, margin, padding)
- Root CSS variables: colors, fonts, spacing (full design system)
- Dark background, basic font setup (Google Font: Inter or Outfit)
- All utility classes and component styles for the entire app
  (screens, buttons, inputs, cards, panels, glassmorphism, animations)
- This file is written COMPLETE in Phase 1 — all styles for all phases
```

#### 1.6 `public/js/app.js` (stub)
```
- const socket = io()
- socket.on('connect', () => console.log('Connected'))
- Screen manager placeholder
```

### ✅ Verify Phase 1
```bash
npm install
npm run dev
# Open http://localhost:3000 → see "Draw Mafia" heading
# Server console: "Player connected: ..."
# Browser console: "Connected to server"
```

---

## Phase 2: Word Bank
> **Goal**: Complete word system with categories, Classic mode words, and Blind Imposter paired words.

### Files

#### 2.1 `src/words.json`
```json
{
  "classic": {
    "animals": ["Cat", "Dog", "Eagle", "Shark", ...],       // 30+ per category
    "food": ["Pizza", "Burger", "Sushi", ...],
    "objects": ["Guitar", "Sword", "Crown", ...],
    "places": ["Beach", "Castle", "Volcano", ...],
    "actions": ["Swimming", "Dancing", "Flying", ...]
  },
  "blind_pairs": {
    "animals": [["Cat", "Dog"], ["Eagle", "Penguin"], ["Shark", "Whale"], ...],
    "food": [["Pizza", "Burger"], ["Cake", "Donut"], ["Sushi", "Taco"], ...],
    "objects": [["Guitar", "Violin"], ["Chair", "Throne"], ["Sword", "Axe"], ...],
    "places": [["Beach", "Mountain"], ["Castle", "Lighthouse"], ...],
    "actions": [["Swimming", "Diving"], ["Dancing", "Running"], ...]
  }
}
```
- Minimum 30 words per category for Classic
- Minimum 15 pairs per category for Blind Imposter
- Total: 150+ classic words, 75+ blind pairs

#### 2.2 `src/WordBank.js`
```
- Load words.json on require
- getRandomWord(category = 'all') → string
  - If 'all', pick random category first, then random word
  - Track used words in a Set per game session
- getWordPair(category = 'all') → { artistWord, imposterWord }
  - Pick a random pair from blind_pairs
  - Randomly assign which is artist vs imposter word
  - Track used pairs
- resetUsedWords() → clear the tracking Set
```

### ✅ Verify Phase 2
```
- Require WordBank in server.js temporarily
- Call getRandomWord() 10 times → no repeats
- Call getWordPair() 5 times → valid pairs
- Remove test code
```

---

## Phase 3: Room Manager
> **Goal**: Full room lifecycle — create, join, leave, settings, host controls.

### File

#### 3.1 `src/RoomManager.js`
```
Data structure — Room object:
{
  code: "ABC123",
  host: playerId,
  players: Map<playerId, { id, name, socketId, isConnected, score }>,
  settings: {
    gameMode: 'classic' | 'blind',
    maxPlayers: 8,
    drawTime: 15,
    drawingPasses: 2,
    drawingVisibility: 'live' | 'reveal',
    discussionTime: 60,
    votingTime: 30,
    rounds: 3,
    wordCategory: 'all',
    imposterCount: 1
  },
  state: 'lobby' | 'playing' | 'finished',
  currentRound: 0,
  gameState: null  // set by GameEngine when game starts
}

Methods:
- createRoom(hostSocketId, hostName) → roomCode
  - Generate 6-char uppercase alphanumeric code (check uniqueness)
  - Create Room object with default settings
  - Add host as first player
  - Return room code

- joinRoom(roomCode, socketId, playerName) → { success, error?, room? }
  - Validate: room exists, not full, not in progress, name not taken
  - Add player to room
  - Return success + room state

- leaveRoom(roomCode, playerId) → { roomDeleted, newHost? }
  - Remove player from room
  - If host left: migrate host to next player
  - If last player left: delete room, return roomDeleted=true
  - If game in progress: mark player as disconnected (don't remove)

- updateSettings(roomCode, playerId, newSettings) → { success, error? }
  - Validate: player is host, room is in lobby state
  - Validate setting values (ranges, imposterCount vs playerCount)
  - Merge new settings

- kickPlayer(roomCode, hostId, targetId) → { success, error? }
  - Validate: requester is host, target exists, target != host
  - Remove target from room

- getRoom(roomCode) → Room | null
- getRoomByPlayerId(playerId) → Room | null
- getSanitizedRoom(roomCode) → room state safe to send to clients (no sensitive data)
- generateRoomCode() → unique 6-char string
```

#### 3.2 Update `src/SocketHandler.js`
```
Import RoomManager

Events to handle:
- 'create-room' (playerName) →
    create room, join socket to room channel, emit 'room-created' with room state

- 'join-room' (roomCode, playerName) →
    join room, join socket to room channel, emit 'room-joined' to player,
    emit 'player-joined' to room

- 'leave-room' () →
    leave room, leave socket channel, emit 'player-left' to room,
    if host changed emit 'host-changed'

- 'update-settings' (settings) →
    update settings, emit 'settings-updated' to room

- 'kick-player' (targetId) →
    kick player, emit 'player-kicked' to target and room

- 'disconnect' →
    same as leave-room but handle gracefully
```

### ✅ Verify Phase 3
```
- Open 3 browser tabs
- Tab 1: Create room → get room code
- Tab 2 & 3: Join room with code
- Tab 1: See all 3 players in lobby
- Tab 1: Change settings → all tabs update
- Tab 1: Kick Tab 3 → Tab 3 returns to home
- Close Tab 2 → Tab 1 sees player left
```

---

## Phase 4: Game Engine
> **Goal**: Complete game logic — role assignment, turn management, voting, scoring, both game modes.

### File

#### 4.1 `src/GameEngine.js`
```
Data structure — GameState (stored in room.gameState):
{
  mode: 'classic' | 'blind',
  round: 1,
  totalRounds: 3,
  phase: 'role-reveal' | 'drawing' | 'discussion' | 'voting' | 'word-guess' | 'results',
  word: "Guitar",
  imposterWord: "Violin" | null,   // only in blind mode
  imposters: [playerId, ...],
  artists: [playerId, ...],
  turnOrder: [playerId, ...],       // shuffled player order
  currentTurnIndex: 0,
  currentPass: 1,                   // which drawing pass (1 to drawingPasses)
  drawingPasses: 2,
  canvasStrokes: [],                // all strokes on the shared canvas
  votes: Map<voterId, targetId>,
  phase timer handles,
  scores: Map<playerId, totalScore>
}

Methods:

--- Role Assignment ---
- startGame(room) →
    Validate: enough players, room in lobby
    Set room.state = 'playing'
    Call startRound(room)

- startRound(room) →
    Increment round counter
    Clear canvas strokes
    Select imposters randomly (1 or 2 based on settings)
    Remaining players are artists
    Pick word: Classic → getRandomWord(); Blind → getWordPair()
    Shuffle turn order
    Emit 'role-reveal' to each player individually:
      - Artists: { role: 'artist', word: "Guitar" }
      - Classic imposter: { role: 'imposter', word: null }
      - Blind imposter: { role: 'artist', word: "Violin" }  ← they think they're an artist!
    Set 3-second timer → startDrawingPhase()

--- Drawing Phase ---
- startDrawingPhase(room) →
    Set phase = 'drawing', currentTurnIndex = 0, currentPass = 1
    Emit 'drawing-phase-started' with turn order
    Call startTurn(room)

- startTurn(room) →
    Get current player from turnOrder[currentTurnIndex]
    Emit 'turn-started' { playerId, timeLimit } to room
    Start timer for drawTime seconds
    On timeout → endTurn(room)

- handleDraw(room, playerId, strokeData) →
    Validate: it's this player's turn, phase is 'drawing'
    Add stroke to canvasStrokes with playerId tag
    If visibility = 'live': broadcast stroke to room immediately
    If visibility = 'reveal': buffer stroke (sent on turn end)

- endTurn(room) →
    If visibility = 'reveal': emit all buffered strokes for this turn
    currentTurnIndex++
    If currentTurnIndex >= turnOrder.length:
      currentPass++
      If currentPass > drawingPasses: → startDiscussionPhase(room)
      Else: currentTurnIndex = 0, startTurn(room)
    Else: startTurn(room)

--- Discussion Phase ---
- startDiscussionPhase(room) →
    Set phase = 'discussion'
    Emit 'discussion-phase-started' { timeLimit: discussionTime }
    Start timer → startVotingPhase(room)

- handleChat(room, playerId, message) →
    Validate player is in room
    Broadcast { playerId, playerName, message, timestamp } to room

--- Voting Phase ---
- startVotingPhase(room) →
    Set phase = 'voting'
    Clear votes
    Emit 'voting-phase-started' { players: votablePlayers, timeLimit }
    Start timer → resolveVote(room)

- handleVote(room, playerId, targetId) →
    Validate: phase is voting, player hasn't voted, target is valid
    Record vote
    Emit 'vote-cast' { playerId } (don't reveal target to others)
    If all players voted → resolveVote(room)

- resolveVote(room) →
    Tally votes
    Find player with most votes (handle ties → no elimination)
    If votedOut player is an imposter:
      Classic mode → startWordGuess(room, votedOutId)
      Blind mode → artists win immediately, show both words
    Else:
      Imposter wins, reveal who imposter was

--- Word Guess (Classic Only) ---
- startWordGuess(room, imposterId) →
    Set phase = 'word-guess'
    Emit 'word-guess-phase' { imposterId, timeLimit: 15 }
    Start 15s timer → imposter didn't guess → artists win

- handleWordGuess(room, playerId, guess) →
    Validate: player is the caught imposter
    If guess matches word (case-insensitive): imposter wins
    Else: artists win

--- Resolution ---
- endRound(room, result) →
    result = { winner: 'artists'|'imposter', imposterIds, word, imposterWord?, votes }
    Calculate and add scores
    Emit 'round-results' with full result data
    If round >= totalRounds: endGame(room)
    Else: wait 8s → startRound(room)

- endGame(room) →
    Set room.state = 'finished'
    Emit 'game-over' with final scoreboard
    Reset room to lobby state after display

--- Scoring ---
- calculateScores(room, result) →
    See scoring table in implementation plan
    Update room.gameState.scores
```

#### 4.2 Update `src/SocketHandler.js`
```
Import GameEngine

New events:
- 'start-game' → GameEngine.startGame(room)
- 'draw' (strokeData) → GameEngine.handleDraw(room, playerId, strokeData)
- 'chat-message' (message) → GameEngine.handleChat(room, playerId, message)
- 'cast-vote' (targetId) → GameEngine.handleVote(room, playerId, targetId)
- 'guess-word' (guess) → GameEngine.handleWordGuess(room, playerId, guess)
```

### ✅ Verify Phase 4
```
- 3 tabs: create room, join, start game
- Console logs: roles assigned, word selected
- Turns cycle through all players
- Voting works, resolution triggers correctly
- Test both Classic and Blind modes
- Score accumulates across rounds
```

---

## Phase 5: Client — Full UI (All Screens)
> **Goal**: Build all 9 screens with full interactivity, wired to socket events.

### Files

#### 5.1 `public/index.html` (complete rewrite)
```
All screens as <section> elements with display toggling:

<section id="screen-home">
  - Game logo (styled via CSS, no image)
  - Player name input
  - "Create Room" button
  - Room code input + "Join Room" button
  - Footer credits

<section id="screen-lobby">
  - Room code display with copy button
  - Player list (scrollable, shows host crown icon)
  - Settings panel (host only):
    - Game Mode toggle: Classic / Blind Imposter
    - Draw Time slider
    - Drawing Passes selector
    - Drawing Visibility toggle: Live / Reveal
    - Discussion Time slider
    - Voting Time slider
    - Rounds selector
    - Word Category dropdown
    - Imposter Count toggle
  - Chat panel (reused in game)
  - "Start Game" button (host only)
  - "Leave Room" button

<section id="screen-role-reveal">
  - Dramatic full-screen reveal
  - Role text + word display
  - Auto-advances after 3 seconds

<section id="screen-game">
  - Top bar: round indicator, phase label, timer bar
  - Left sidebar: player list with turn indicator (glowing border)
  - Center: large canvas element
  - Bottom bar: drawing tools (only active on player's turn)
    - Color palette (12 preset colors + custom picker)
    - Brush size slider (3 presets: S/M/L)
    - Eraser toggle
    - Undo button
    - Clear own strokes button
  - Right sidebar: chat panel
  - Word display bar (shows word for artists, "???" for classic imposter)

<section id="screen-discussion">
  - Canvas (locked, view only)
  - Large chat panel (center focus)
  - Timer
  - "Who seems suspicious?" prompt

<section id="screen-voting">
  - Player cards grid (click to vote)
  - Each card: player name, avatar color
  - Selected card highlighted
  - "Confirm Vote" button
  - "Skip Vote" button
  - Timer
  - Vote count indicators (X/N voted)

<section id="screen-word-guess">
  - "The imposter has been caught!" heading
  - Imposter name display
  - Text input + "Guess" button (only for caught imposter)
  - Spectator view for others
  - Timer

<section id="screen-results">
  - Winner announcement (Artists Win! / Imposter Wins!)
  - Imposter reveal with word(s)
  - Vote breakdown
  - Points awarded this round
  - "Next Round" countdown or "Game Over" indicator

<section id="screen-gameover">
  - Final scoreboard (ranked)
  - Podium display (top 3)
  - "Play Again" button
  - "Back to Lobby" button

- Audio control: mute/unmute button (floating, always visible)
```

#### 5.2 `public/js/app.js` (complete rewrite)
```
Screen Management:
- showScreen(screenId) → hide all sections, show target with transition
- getCurrentScreen() → active screen id

Socket Connection:
- const socket = io()
- Handle reconnection logic

Event Wiring — Outgoing (user actions → server):
- createRoom(playerName)
- joinRoom(roomCode, playerName)
- leaveRoom()
- updateSettings(settings)
- kickPlayer(targetId)
- startGame()
- sendDraw(strokeData)
- sendChat(message)
- castVote(targetId)
- guessWord(guess)

Event Wiring — Incoming (server → UI updates):
- 'room-created' → show lobby, display room code
- 'room-joined' → show lobby
- 'player-joined' → update player list
- 'player-left' → update player list
- 'host-changed' → update host UI
- 'settings-updated' → update settings display
- 'player-kicked' → if self, go home with message
- 'role-reveal' → show role reveal screen with data
- 'drawing-phase-started' → show game screen
- 'turn-started' → highlight current player, enable/disable canvas
- 'stroke' → draw incoming stroke on canvas
- 'turn-ended' → if reveal mode, draw all strokes at once
- 'discussion-phase-started' → show discussion screen
- 'voting-phase-started' → show voting screen
- 'vote-cast' → update vote count
- 'word-guess-phase' → show word guess screen
- 'round-results' → show results screen
- 'game-over' → show game over screen
- 'chat' → append chat message
- 'timer-sync' → update timer display
- 'error' → show toast notification

State Management:
- myPlayerId, myRoom, myRole, myWord
- isHost, isMyTurn
- currentPhase
```

#### 5.3 `public/js/ui.js` (complete)
```
Rendering Helpers:
- renderPlayerList(players, currentTurnId, myId, isHost)
  - Show crown icon for host
  - Glow border for current turn
  - "You" label for self
  - Kick button (host only, on other players)

- renderChat(messages)
  - Auto-scroll to bottom
  - Different styling for system messages vs player messages

- renderVotingCards(players, myId)
  - Grid of clickable player cards
  - Highlight selected
  - Disable self-voting

- renderSettings(settings, isHost)
  - Editable controls for host, read-only display for others
  - Dynamic: show imposterCount=2 option only when 6+ players

- renderResults(resultData)
  - Winner banner with animation
  - Imposter reveal
  - Score changes

- renderScoreboard(scores)
  - Sorted by score, rank badges

- showToast(message, type)
  - Slide-in notification (success/error/info)
  - Auto-dismiss after 3s

- updateTimer(secondsLeft, totalSeconds)
  - Animated progress bar
  - Color changes: green → yellow → red

- copyToClipboard(text)
  - Copy room code, show "Copied!" feedback
```

### ✅ Verify Phase 5
```
- All screens render correctly
- Navigation between screens works
- Settings panel updates in real-time for all players
- Chat works in lobby and during game
- Player list updates on join/leave
- Voting cards are clickable and confirmable
- Timer bar animates smoothly
```

---

## Phase 6: Canvas Drawing Engine
> **Goal**: Fully functional collaborative drawing canvas with tools.

### File

#### 6.1 `public/js/canvas.js` (complete)
```
Canvas Setup:
- Get canvas element, set dimensions (responsive)
- Get 2D context
- Handle window resize (redraw all strokes)
- Set up offscreen buffer for performance

Drawing State:
- isDrawing: boolean
- currentColor: string
- currentSize: number (1-20)
- currentTool: 'pen' | 'eraser'
- myStrokes: [] (strokes drawn by me this turn)
- allStrokes: [] (all strokes on canvas)

Mouse/Touch Events:
- pointerdown → start new stroke, begin path
- pointermove → add point to current stroke, draw segment
- pointerup → end stroke, emit to server
- Handle both mouse and touch input via Pointer Events API

Stroke Data Format:
{
  id: unique string,
  playerId: string,
  points: [{x, y}, ...],  // normalized 0-1 coordinates (resolution independent)
  color: "#hex",
  size: number,
  tool: 'pen' | 'eraser'
}

Methods:
- enableDrawing() → attach pointer listeners, show "Your turn!" indicator
- disableDrawing() → detach listeners, show whose turn it is
- drawStroke(stroke) → render a single stroke on canvas
- drawAllStrokes() → clear canvas, redraw all strokes (for resize/reveal)
- addRemoteStroke(stroke) → add to allStrokes, draw it (live mode)
- revealTurnStrokes(strokes) → add batch of strokes, redraw (reveal mode)
- undoLastStroke() → remove last from myStrokes, redraw all
- clearCanvas() → wipe canvas and allStrokes (new round)
- setColor(color)
- setSize(size)
- setTool(tool)
- getCanvasDataURL() → for potential future screenshot feature

Tool UI Wiring:
- Color palette buttons → setColor
- Size buttons (S/M/L) → setSize(3/8/15)
- Eraser toggle → setTool
- Undo button → undoLastStroke
- Custom color picker → setColor

Coordinate Normalization:
- Store points as ratios (0-1) relative to canvas size
- This ensures strokes look the same on different screen sizes
- Convert to pixel coords only when rendering
```

### ✅ Verify Phase 6
```
- Draw on canvas → strokes appear smoothly
- Switch colors, sizes, eraser → all work
- Undo removes last stroke
- Resize browser → canvas redraws correctly
- Multi-tab: draw on one → appears on others (live mode)
- Multi-tab: draw on one → appears on turn end (reveal mode)
- Canvas locks when it's not your turn
```

---

## Phase 7: Audio Engine & Polish
> **Goal**: Add sound effects, micro-animations, final polish, edge case handling.

### Files

#### 7.1 `public/js/audio.js` (complete)
```
Web Audio API Setup:
- Create AudioContext (lazy init on first user interaction)
- Master gain node for volume control

Synthesized Sound Functions (no external files):
- playTick()
  - Short sine wave blip (800Hz, 50ms, quick decay)
  - Used for: timer countdown (last 5 seconds)

- playDing()
  - Pleasant chime (two sine waves: 523Hz + 659Hz, 200ms)
  - Used for: turn start, your turn notification

- playWhoosh()
  - Filtered white noise sweep (300ms)
  - Used for: screen/phase transitions

- playReveal()
  - Dramatic chord (three oscillators: C-E-G, 800ms, reverb-like decay)
  - Used for: role reveal, imposter reveal

- playVoteDrum()
  - Low frequency pulse (100Hz, 150ms)
  - Used for: each vote cast

- playWinFanfare()
  - Rising arpeggio (C5-E5-G5-C6, 200ms each, sine wave)
  - Used for: artists win

- playLoseBuzzer()
  - Descending buzz (sawtooth wave 400→100Hz, 500ms)
  - Used for: imposter wins (for artists), getting caught

- playMessage()
  - Subtle pop sound (1000Hz, 30ms)
  - Used for: new chat message

Controls:
- setVolume(0-1)
- mute() / unmute() / toggleMute()
- isMuted: boolean
- Persist mute preference in localStorage
```

#### 7.2 Polish Additions (updates to existing files)

**`public/css/style.css`** additions:
```
- Particle/ambient background animation on home screen (CSS-only floating dots)
- Role reveal: dramatic zoom + glow animation
- Screen transitions: fade + slide
- Voting card: pulse animation when vote is locked in
- Timer bar: smooth color gradient transition (green→yellow→red)
- Canvas tools: subtle hover and active states
- Chat messages: slide-in animation
- Toast notifications: slide + fade
- Scoreboard: count-up animation for scores
- "Your Turn!" pulsing banner
- Crown icon animation for host
- Responsive breakpoints (tablet: stack sidebar below canvas)
```

**`server.js` / `src/GameEngine.js`** additions:
```
- Handle player disconnect mid-game:
  - Skip disconnected player's turn
  - Auto-skip their vote
  - If imposter disconnects: artists win automatically
  - If enough artists disconnect that game can't continue: end game
- Handle voting ties: no elimination (imposter survives)
- Prevent starting game with fewer players than imposterCount + 2
- Rate-limit chat messages (prevent spam)
- Sanitize chat input (XSS prevention)
- Room auto-cleanup: delete rooms with no connected players after 60s
```

**`public/js/app.js`** additions:
```
- Reconnection handling: attempt to rejoin room on reconnect
- localStorage: remember player name
- Prevent accidental page close during game (beforeunload warning)
- Keyboard shortcuts: Enter to send chat, Esc to cancel vote
- Mobile touch improvements
```

### ✅ Verify Phase 7 (Final)
```
- All sound effects play at appropriate moments
- Mute toggle works, persists across page reload
- Animations are smooth and non-janky
- Disconnect/reconnect handles gracefully
- Chat is sanitized (no XSS)
- Voting ties resolve correctly
- Full game: 3 players, Classic mode, 3 rounds → complete without errors
- Full game: 6 players, Blind mode, 2 imposters → complete without errors
- Responsive: playable on tablet-sized viewport
```

---

## Phase Summary

| Phase | Deliverables | Depends On |
|---|---|---|
| **1. Scaffold** | package.json, server.js, SocketHandler stub, index.html stub, **complete style.css** | — |
| **2. Word Bank** | words.json, WordBank.js | — |
| **3. Room Manager** | RoomManager.js, SocketHandler (room events) | Phase 1 |
| **4. Game Engine** | GameEngine.js, SocketHandler (game events) | Phase 2, 3 |
| **5. Client UI** | index.html (all screens), app.js, ui.js | Phase 1, 3, 4 |
| **6. Canvas** | canvas.js | Phase 5 |
| **7. Audio & Polish** | audio.js, polish all files | Phase 1–6 |

> [!TIP]
> **Phases 1-2 are independent** and can be built in parallel.
> **Phases 3-4 are server-side** and build on each other.
> **Phases 5-6 are client-side** and depend on the server being ready.
> **Phase 7 ties everything together.**

---

## Final File Tree

```
draw-mafia/
├── package.json
├── server.js
├── src/
│   ├── GameEngine.js
│   ├── RoomManager.js
│   ├── SocketHandler.js
│   ├── WordBank.js
│   └── words.json
└── public/
    ├── index.html
    ├── css/
    │   └── style.css
    └── js/
        ├── app.js
        ├── canvas.js
        ├── ui.js
        └── audio.js
```

**Total: 12 files. Zero external services. Zero cost.**
