/* ═══════════════════════════════════════════════════════════
   CANVAS DRAWING ENGINE
   ═══════════════════════════════════════════════════════════ */

const DrawCanvas = (() => {
  let canvas, ctx;
  let discCanvas, discCtx;
  let drawingEnabled = false;
  let isDrawing = false;
  let currentColor = '#000000';
  let currentSize = 8;
  let currentTool = 'pen';
  let myStrokes = [];
  let allStrokes = [];
  let currentStroke = null;
  let onStrokeCallback = null;
  let devicePixelRatio = 1;
  const LOGICAL_W = 800;
  const LOGICAL_H = 500;

  const COLORS = [
    '#000000', '#ffffff', '#ff4060', '#ff8c00', '#ffcc00', '#00e87b',
    '#00cfff', '#7c5cff', '#ff69b4', '#40e0d0', '#8b4513',
    '#808080',
  ];

  function init(canvasEl, discCanvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    discCanvas = discCanvasEl;
    discCtx = discCanvas.getContext('2d');
    devicePixelRatio = window.devicePixelRatio || 1;
    resize();
    window.addEventListener('resize', resize);
    buildPalette();
    setupPointerEvents();
    updateCursor();
  }

  function resize() {
    fitCanvas(canvas, ctx);
    fitCanvas(discCanvas, discCtx);
    redraw();
  }

  function resizeDiscCanvas() {
    fitCanvas(discCanvas, discCtx);
    drawAllStrokes(discCtx, allStrokes);
  }

  function fitCanvas(c, cCtx) {
    if (!c) return;
    const parent = c.parentElement;
    if (!parent) return;
    const w = parent.clientWidth - 20;
    const h = parent.clientHeight - 20;
    if (w <= 0 || h <= 0) {
      c.style.width = LOGICAL_W + 'px';
      c.style.height = LOGICAL_H + 'px';
      c.width = LOGICAL_W * devicePixelRatio;
      c.height = LOGICAL_H * devicePixelRatio;
      cCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      return;
    }
    const aspect = LOGICAL_W / LOGICAL_H;
    let cw, ch;
    if (w / h > aspect) {
      ch = Math.min(h, LOGICAL_H);
      cw = ch * aspect;
    } else {
      cw = Math.min(w, LOGICAL_W);
      ch = cw / aspect;
    }
    c.style.width = cw + 'px';
    c.style.height = ch + 'px';
    c.width = LOGICAL_W * devicePixelRatio;
    c.height = LOGICAL_H * devicePixelRatio;
    cCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function setupPointerEvents() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);
  }

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function onPointerDown(e) {
    if (!drawingEnabled) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    const pt = getCanvasCoords(e);
    currentStroke = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      points: [pt],
      color: currentTool === 'eraser' ? '#ffffff' : currentColor,
      size: currentTool === 'eraser' ? currentSize * 3 : currentSize,
      tool: currentTool,
    };
  }

  function onPointerMove(e) {
    if (!isDrawing || !currentStroke) return;
    e.preventDefault();
    const pt = getCanvasCoords(e);
    currentStroke.points.push(pt);
    drawStroke(ctx, currentStroke);
  }

  function onPointerUp(e) {
    if (!isDrawing || !currentStroke) return;
    isDrawing = false;
    if (currentStroke.points.length > 1) {
      myStrokes.push(currentStroke);
      allStrokes.push(currentStroke);
      if (onStrokeCallback) onStrokeCallback(currentStroke);
    }
    currentStroke = null;
  }

  function drawStroke(cCtx, stroke) {
    if (!stroke || stroke.points.length < 2) return;
    cCtx.save();
    cCtx.lineCap = 'round';
    cCtx.lineJoin = 'round';
    cCtx.strokeStyle = stroke.color;
    cCtx.lineWidth = stroke.size;
    cCtx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    cCtx.beginPath();
    cCtx.moveTo(stroke.points[0].x * LOGICAL_W, stroke.points[0].y * LOGICAL_H);
    for (let i = 1; i < stroke.points.length; i++) {
      cCtx.lineTo(stroke.points[i].x * LOGICAL_W, stroke.points[i].y * LOGICAL_H);
    }
    cCtx.stroke();
    cCtx.restore();
  }

  function drawAllStrokes(cCtx, strokes) {
    if (!cCtx) return;
    cCtx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    strokes.forEach((s) => drawStroke(cCtx, s));
  }

  function redraw() {
    drawAllStrokes(ctx, allStrokes);
    drawAllStrokes(discCtx, allStrokes);
  }

  function buildPalette() {
    const palette = document.getElementById('palette');
    if (!palette) return;
    palette.innerHTML = '';
    COLORS.forEach((c) => {
      const swatch = UI.el('div', 'color-swatch' + (c === currentColor ? ' active' : ''));
      swatch.style.background = c;
      if (c === '#000000') swatch.style.border = '2px solid #555';
      swatch.onclick = () => {
        setColor(c);
        palette.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('active'));
        swatch.classList.add('active');
      };
      palette.appendChild(swatch);
    });
  }

  function setColor(c) { currentColor = c; currentTool = 'pen'; updateToolUI(); updateCursor(); }
  function setSize(s) { currentSize = s; updateCursor(); }
  function setTool(t) { currentTool = t; updateToolUI(); updateCursor(); }

  function updateToolUI() {
    const eraserBtn = document.getElementById('btn-eraser');
    if (eraserBtn) eraserBtn.classList.toggle('active', currentTool === 'eraser');
  }

  function updateCursor() {
    if (!canvas) return;
    const size = currentTool === 'eraser' ? currentSize * 3 : currentSize;
    const color = currentTool === 'eraser' ? '#ffffff' : currentColor;
    const cursorSize = Math.max(size + 4, 16);
    const half = cursorSize / 2;

    const off = document.createElement('canvas');
    off.width = cursorSize;
    off.height = cursorSize;
    const octx = off.getContext('2d');

    octx.beginPath();
    octx.arc(half, half, size / 2, 0, Math.PI * 2);
    octx.fillStyle = color;
    octx.fill();
    octx.lineWidth = 2;
    octx.strokeStyle = color === '#000000' ? '#ffffff' : '#000000';
    octx.stroke();

    canvas.style.cursor = 'url(' + off.toDataURL() + ') ' + half + ' ' + half + ', crosshair';
  }

  function enableDrawing() {
    drawingEnabled = true;
    updateCursor();
  }

  function disableDrawing() {
    drawingEnabled = false;
    isDrawing = false;
    canvas.style.cursor = 'default';
  }

  function addRemoteStroke(stroke) {
    allStrokes.push(stroke);
    drawStroke(ctx, stroke);
  }

  function revealTurnStrokes(strokes) {
    strokes.forEach((s) => allStrokes.push(s));
    drawAllStrokes(ctx, allStrokes);
  }

  function undoLastStroke() {
    if (myStrokes.length === 0) return;
    const removed = myStrokes.pop();
    const idx = allStrokes.indexOf(removed);
    if (idx !== -1) allStrokes.splice(idx, 1);
    drawAllStrokes(ctx, allStrokes);
  }

  function clearCanvas() {
    myStrokes = [];
    allStrokes = [];
    drawAllStrokes(ctx, allStrokes);
    drawAllStrokes(discCtx, allStrokes);
  }

  function copyToDiscussion() {
    drawAllStrokes(discCtx, allStrokes);
  }

  function onStroke(cb) { onStrokeCallback = cb; }
  function getStrokes() { return allStrokes; }

  return {
    init,
    resize,
    resizeDiscCanvas,
    enableDrawing,
    disableDrawing,
    setColor,
    setSize,
    setTool,
    addRemoteStroke,
    revealTurnStrokes,
    undoLastStroke,
    clearCanvas,
    copyToDiscussion,
    onStroke,
    getStrokes,
    COLORS,
  };
})();
