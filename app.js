/* =========================================================================
   MeesaJarJar's ISO Slicer V4 — MeesaJarJar.com
   Single-file app logic. No build step, no frameworks.
   ========================================================================= */

(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const stageWrap   = document.getElementById('stage-wrap');
  const stage        = document.getElementById('stage');
  const dropzone     = document.getElementById('dropzone');
  const fileInput    = document.getElementById('file-input');
  const baseCanvas   = document.getElementById('canvas-base');
  const gridCanvas   = document.getElementById('canvas-grid');
  const maskCanvas   = document.getElementById('canvas-mask');
  const overlayCanvas= document.getElementById('canvas-overlay');
  const hud          = document.getElementById('hud');
  const hudImgSize   = document.getElementById('hud-imgsize');
  const hudTile      = document.getElementById('hud-tile');
  const hudZoom      = document.getElementById('hud-zoom');
  const zoomControls = document.getElementById('zoom-controls');
  const toastEl       = document.getElementById('toast');
  const layerListEl  = document.getElementById('layer-list');
  const layerCountEl = document.getElementById('layer-count');
  const exportBtn    = document.getElementById('btn-export');
  const statusTool   = document.getElementById('status-tool');
  const statusLayer  = document.getElementById('status-layer');
  const statusMsg    = document.getElementById('status-msg');
  const hintBox       = document.getElementById('hint-select');

  const twRange = document.getElementById('tw-range');
  const twNum   = document.getElementById('tw-num');
  const thRange = document.getElementById('th-range');
  const thNum   = document.getElementById('th-num');
  const oxRange = document.getElementById('ox-range');
  const oxNum   = document.getElementById('ox-num');
  const oyRange = document.getElementById('oy-range');
  const oyNum   = document.getElementById('oy-num');
  const scRange = document.getElementById('sc-range');
  const scNum   = document.getElementById('sc-num');
  const gridVisibleChk = document.getElementById('grid-visible');

  const ctxBase    = baseCanvas.getContext('2d');
  const ctxGrid    = gridCanvas.getContext('2d');
  const ctxMask    = maskCanvas.getContext('2d');
  const ctxOverlay = overlayCanvas.getContext('2d');

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  const state = {
    img: null,            // HTMLImageElement
    imgW: 0, imgH: 0,
    // view transform: screen = (world * zoom) + pan
    zoom: 1,
    panX: 0, panY: 0,
    // grid params, in IMAGE pixel space
    tileW: 44,
    tileH: 44,
    offX: 0,
    offY: 0,
    imgScale: 0.6,
    showGrid: true,
    imgVisible: true,
    snapToTileCorners: false,
    // tool
    tool: 'select',       // 'select' | 'mask' | 'pan'
    // selection
    selectedTile: null,   // {tx, ty} grid coords of the chosen anchor tile (relative, can be negative)
    // mask drawing
    drawingPoints: [],    // array of {x,y} in IMAGE pixel space, while actively drawing
    isDrawing: false,
    // layers
    layers: [],           // {id, name, tile:{tx,ty}, points:[{x,y}], color, visible}
    activeLayerId: null,
    // history
    undoStack: [],
    redoStack: [],
    // panning interaction
    isPanning: false,
    panStart: null,
    // misc
    nextLayerNum: 1,
    hoverTile: null,
  };

  const LAYER_COLORS = [
    '#ffb238', '#3ddbd9', '#e2584f', '#8b7cf6', '#5ec46a',
    '#ec5fa6', '#52a8e8', '#e0c23d', '#f08a4b', '#6fd6a8'
  ];

  // Cache for extracted masked regions
  let extractedRegions = {};

  // ---------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', !!isError);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }
  function setStatusMsg(msg) {
    statusMsg.textContent = msg || '';
  }

  // ---------------------------------------------------------------------
  // Image loading (drop / paste / file picker)
  // ---------------------------------------------------------------------
  function loadImageFromFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      toast('That file is not an image.', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => loadImageFromSrc(e.target.result);
    reader.readAsDataURL(file);
  }

  function loadImageFromSrc(src) {
    const img = new Image();
    img.onload = () => {
      state.img = img;
      state.imgW = img.naturalWidth;
      state.imgH = img.naturalHeight;
      // Reset per-image state
      state.layers = [];
      state.selectedTile = null;
      state.activeLayerId = null;
      state.drawingPoints = [];
      state.isDrawing = false;
      state.undoStack = [];
      state.redoStack = [];
      state.nextLayerNum = 1;

      // Keep existing tile size (default 44×44)
      state.offX = 0;
      state.offY = 0;

      dropzone.style.display = 'none';
      hud.style.display = 'flex';
      zoomControls.style.display = 'flex';
      exportBtn.disabled = true;

      // Reset image visibility when loading a new image
      state.imgVisible = true;
      imgVisibleChk.checked = true;

      // Reset image scale
      state.imgScale = 0.6;

      syncGridControlsFromState();

      // Clear all cached regions when loading a new image
      extractedRegions = {};
      
      // Clear all layers' rendered flags
      for (const layer of state.layers) {
        layer._regionRendered = false;
      }

      fitToView();
      renderAll();
      renderLayerList();
      toast('Image loaded — ' + state.imgW + '×' + state.imgH);
    };
    img.onerror = () => toast('Could not load that image.', true);
    img.src = src;
  }

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) loadImageFromFile(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach(evt => {
    window.addEventListener(evt, (e) => {
      e.preventDefault();
      if (!state.img) dropzone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    window.addEventListener(evt, (e) => {
      if (evt === 'dragleave' && e.target !== dropzone && !dropzone.contains(e.target)) return;
      dropzone.classList.remove('drag-over');
    });
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      loadImageFromFile(dt.files[0]);
    }
  });

  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.indexOf('image') === 0) {
        const blob = item.getAsFile();
        loadImageFromFile(blob);
        e.preventDefault();
        return;
      }
    }
  });

  document.getElementById('btn-new-image').addEventListener('click', () => {
    if (state.layers.length && !confirm('Load a new image? Current layers will be lost.')) return;
    state.img = null;
    dropzone.style.display = 'flex';
    hud.style.display = 'none';
    zoomControls.style.display = 'none';
    state.imgVisible = true;
    imgVisibleChk.checked = true;
    state.imgScale = 0.6;
    syncGridControlsFromState();
    renderLayerList();
  });

  // ---------------------------------------------------------------------
  // View transform helpers
  // ---------------------------------------------------------------------
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function resizeCanvases() {
    const rect = stageWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    [baseCanvas, gridCanvas, maskCanvas, overlayCanvas].forEach(c => {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
      c.style.width = rect.width + 'px';
      c.style.height = rect.height + 'px';
    });
    state.viewW = rect.width;
    state.viewH = rect.height;
    state.dpr = dpr;
  }

  function fitToView() {
    if (!state.img) return;
    const rect = stageWrap.getBoundingClientRect();
    const margin = 60;
    const scale = Math.min(
      (rect.width - margin * 2) / state.imgW,
      (rect.height - margin * 2) / state.imgH,
      1.5
    );
    state.zoom = clamp(scale, 0.05, 8);
    state.panX = (rect.width - state.imgW * state.zoom) / 2;
    state.panY = (rect.height - state.imgH * state.zoom) / 2;
  }

  // world (image-pixel) -> screen
  function w2s(x, y) {
    return [x * state.zoom + state.panX, y * state.zoom + state.panY];
  }
  // screen -> world
  function s2w(x, y) {
    return [(x - state.panX) / state.zoom, (y - state.panY) / state.zoom];
  }

  function setZoom(newZoom, centerScreenX, centerScreenY) {
    const rect = stageWrap.getBoundingClientRect();
    const cx = centerScreenX != null ? centerScreenX : rect.width / 2;
    const cy = centerScreenY != null ? centerScreenY : rect.height / 2;
    const [wx, wy] = s2w(cx, cy);
    state.zoom = clamp(newZoom, 0.05, 16);
    state.panX = cx - wx * state.zoom;
    state.panY = cy - wy * state.zoom;
    renderAll();
  }

  // ---------------------------------------------------------------------
  // Isometric grid math
  // Diamond tile: width tileW, height tileH, centered grid.
  // Tile (tx, ty) center in image space:
  //   cx = offX + (tx - ty) * (tileW/2)
  //   cy = offY + (tx + ty) * (tileH/2)
  // This matches standard UO-style iso projection.
  // ---------------------------------------------------------------------
  function tileCenter(tx, ty) {
    const cx = state.offX + (tx - ty) * (state.tileW / 2);
    const cy = state.offY + (tx + ty) * (state.tileH / 2);
    return [cx, cy];
  }

  // Inverse: image pixel -> nearest tile coords
  function pixelToTile(px, py) {
    const x = px - state.offX;
    const y = py - state.offY;
    const tw = state.tileW / 2, th = state.tileH / 2;
    // x = (tx-ty)*tw ; y = (tx+ty)*th
    // tx - ty = x/tw ; tx + ty = y/th
    const a = x / tw;
    const b = y / th;
    const tx = (a + b) / 2;
    const ty = (b - a) / 2;
    return [Math.round(tx), Math.round(ty)];
  }

  function tileDiamondPoints(tx, ty) {
    const [cx, cy] = tileCenter(tx, ty);
    const hw = state.tileW / 2, hh = state.tileH / 2;
    return [
      [cx, cy - hh],   // top
      [cx + hw, cy],   // right
      [cx, cy + hh],   // bottom
      [cx - hw, cy],   // left
    ];
  }

  // Snap a world-space point to the nearest tile corner (top/right/bottom/left of diamond).
  // Searches tiles within a reasonable range of the cursor.
  const SNAP_RADIUS_WORLD_PX = 12;
  function nearestTileCorner(wx, wy) {
    const [ttx, tty] = pixelToTile(wx, wy);
    let bestDist = SNAP_RADIUS_WORLD_PX;
    let bestPt = null;
    for (let dty = -2; dty <= 2; dty++) {
      for (let dtx = -2; dtx <= 2; dtx++) {
        const corners = tileDiamondPoints(ttx + dtx, tty + dty);
        for (const [cx, cy] of corners) {
          const dist = Math.hypot(cx - wx, cy - wy);
          if (dist < bestDist) {
            bestDist = dist;
            bestPt = { x: cx, y: cy };
          }
        }
      }
    }
    return bestPt;
  }

  // ---------------------------------------------------------------------
  // Scan art above a tile — for every X pixel between the tile's left
  // and right diamond edges, scan straight up until hitting whitespace.
  // Returns { top, left, right, bottom } in image-pixel coords, or null.
  // ---------------------------------------------------------------------
  function scanArtAbove(tx, ty) {
    if (!state.img) return null;

    const [cx, cy] = tileCenter(tx, ty);
    const hw = state.tileW / 2, hh = state.tileH / 2;
    const tileBottom = cy + hh;

    const tileLeft = Math.floor(cx - hw);
    const tileRight = Math.ceil(cx + hw);

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = state.imgW;
    tmpCanvas.height = state.imgH;
    const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });
    tmpCtx.drawImage(state.img, 0, 0);
    const imgData = tmpCtx.getImageData(0, 0, state.imgW, state.imgH);
    const px = imgData.data;

    const W = state.imgW, H = state.imgH;

    function hasAlpha(x, y) {
      if (x < 0 || x >= W || y < 0 || y >= H) return false;
      return px[(y * W + x) * 4 + 3] > 0;
    }

    const startRow = Math.floor(cy - hh);
    let artTop = startRow;

    for (let x = tileLeft; x <= tileRight; x++) {
      for (let y = startRow - 1; y >= 0; y--) {
        if (hasAlpha(x, y)) {
          if (y < artTop) artTop = y;
        }
      }
    }

    if (artTop === startRow) return null;

    return {
      top: artTop,
      bottom: Math.ceil(tileBottom),
      left: tileLeft,
      right: tileRight,
    };
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function renderAll() {
    if (!state.img) return;
    renderBase();
    renderGrid();
    renderMaskLayers();
    renderOverlay();
    renderCachedRegions();
    updateHud();
  }

  function clearCtx(ctx, canvas) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function applyViewTransform(ctx) {
    const dpr = state.dpr || 1;
    ctx.setTransform(state.zoom * dpr, 0, 0, state.zoom * dpr, state.panX * dpr, state.panY * dpr);
  }

  function renderBase() {
    clearCtx(ctxBase, baseCanvas);
    if (state.imgVisible) {
      ctxBase.save();
      applyViewTransform(ctxBase);
      ctxBase.translate(state.imgW / 2, state.imgH / 2);
      ctxBase.scale(state.imgScale, state.imgScale);
      ctxBase.translate(-state.imgW / 2, -state.imgH / 2);
      ctxBase.imageSmoothingEnabled = false;
      ctxBase.drawImage(state.img, 0, 0);
      ctxBase.restore();
    }
  }

  // Visible tile range computed from viewport corners (so grid scales to any pan/zoom)
  function visibleTileRange() {
    const corners = [
      s2w(0, 0), s2w(state.viewW, 0), s2w(0, state.viewH), s2w(state.viewW, state.viewH)
    ];
    let minTx = Infinity, maxTx = -Infinity, minTy = Infinity, maxTy = -Infinity;
    for (const [px, py] of corners) {
      const [tx, ty] = pixelToTile(px, py);
      minTx = Math.min(minTx, tx); maxTx = Math.max(maxTx, tx);
      minTy = Math.min(minTy, ty); maxTy = Math.max(maxTy, ty);
    }
    const pad = 2;
    return {
      minTx: minTx - pad, maxTx: maxTx + pad,
      minTy: minTy - pad, maxTy: maxTy + pad,
    };
  }

  function renderGrid() {
    clearCtx(ctxGrid, gridCanvas);
    if (!state.showGrid) return;
    ctxGrid.save();
    applyViewTransform(ctxGrid);

    const { minTx, maxTx, minTy, maxTy } = visibleTileRange();
    ctxGrid.lineWidth = 1 / state.zoom;
    ctxGrid.strokeStyle = 'rgba(61, 219, 217, 0.55)';

    ctxGrid.beginPath();
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        const pts = tileDiamondPoints(tx, ty);
        ctxGrid.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctxGrid.lineTo(pts[i][0], pts[i][1]);
        ctxGrid.closePath();
      }
    }
    ctxGrid.stroke();

    // Origin tile marker (0,0) — subtle, helps orient the user
    const originPts = tileDiamondPoints(0, 0);
    ctxGrid.beginPath();
    ctxGrid.moveTo(originPts[0][0], originPts[0][1]);
    for (let i = 1; i < originPts.length; i++) ctxGrid.lineTo(originPts[i][0], originPts[i][1]);
    ctxGrid.closePath();
    ctxGrid.strokeStyle = 'rgba(61, 219, 217, 0.95)';
    ctxGrid.lineWidth = 1.6 / state.zoom;
    ctxGrid.stroke();

    // Hovered tile highlight (light)
    if (state.hoverTile && state.tool === 'select') {
      drawDiamondFill(ctxGrid, state.hoverTile[0], state.hoverTile[1], 'rgba(255,255,255,0.08)', null);
    }

    // Selected tile highlight (gold, like reference image)
    if (state.selectedTile) {
      drawDiamondFill(ctxGrid, state.selectedTile.tx, state.selectedTile.ty, 'rgba(255,178,56,0.22)', '#ffb238', 2.2);
    }

    // Multiple selected tiles highlight (lighter gold)
    if (state.selectedTiles && state.selectedTiles.length > 0) {
      for (const tile of state.selectedTiles) {
        drawDiamondFill(ctxGrid, tile.tx, tile.ty, 'rgba(255,178,56,0.12)', '#ffb238', 1.8);
      }
    }

    ctxGrid.restore();
  }

  function drawDiamondFill(ctx, tx, ty, fillStyle, strokeStyle, lineWidthOverride) {
    const pts = tileDiamondPoints(tx, ty);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = (lineWidthOverride || 1.5) / state.zoom;
      ctx.stroke();
    }
  }

  // Draw all completed layer mask outlines (tinted by layer color) + anchor tile markers
  function renderMaskLayers() {
    clearCtx(ctxMask, maskCanvas);
    ctxMask.save();
    applyViewTransform(ctxMask);

    for (const layer of state.layers) {
      if (!layer.visible) continue;
      const isActive = layer.id === state.activeLayerId;
      drawPolygon(ctxMask, layer.points, {
        fill: hexToRgba(layer.color, isActive ? 0.18 : 0.10),
        stroke: layer.color,
        lineWidth: (isActive ? 2.2 : 1.4) / state.zoom,
        dash: isActive ? null : [6 / state.zoom, 4 / state.zoom],
      });
      // anchor tile marker
      drawDiamondFill(ctxMask, layer.tile.tx, layer.tile.ty, hexToRgba(layer.color, 0.28), layer.color, 1.8);
    }

    ctxMask.restore();
  }

  function drawPolygon(ctx, points, { fill, stroke, lineWidth, dash } = {}) {
    if (!points || points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.setLineDash(dash || []);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // In-progress mask drawing + crosshair etc.
  function renderOverlay() {
    clearCtx(ctxOverlay, overlayCanvas);
    ctxOverlay.save();
    applyViewTransform(ctxOverlay);

    if (state.tool === 'mask' && state.drawingPoints.length) {
      const color = nextLayerColor();
      drawPolygon(ctxOverlay, state.drawingPoints, {
        stroke: color,
        lineWidth: 2 / state.zoom,
      });
      // vertex dots
      ctxOverlay.fillStyle = color;
      for (const p of state.drawingPoints) {
        ctxOverlay.beginPath();
        ctxOverlay.arc(p.x, p.y, 3.5 / state.zoom, 0, Math.PI * 2);
        ctxOverlay.fill();
      }
      // first point ring (close target)
      const first = state.drawingPoints[0];
      ctxOverlay.beginPath();
      ctxOverlay.arc(first.x, first.y, 6 / state.zoom, 0, Math.PI * 2);
      ctxOverlay.strokeStyle = color;
      ctxOverlay.lineWidth = 1.5 / state.zoom;
      ctxOverlay.stroke();
    }

    // Snap-to-corner target dots
    if (state.snapToTileCorners && state.tool === 'mask') {
      const { minTx, maxTx, minTy, maxTy } = visibleTileRange();
      ctxOverlay.fillStyle = 'rgba(255,255,255,0.7)';
      const r = 2.5 / state.zoom;
      for (let tx = minTx; tx <= maxTx; tx++) {
        for (let ty = minTy; ty <= maxTy; ty++) {
          const corners = tileDiamondPoints(tx, ty);
          for (const [cx, cy] of corners) {
            ctxOverlay.beginPath();
            ctxOverlay.arc(cx, cy, r, 0, Math.PI * 2);
            ctxOverlay.fill();
          }
        }
      }
    }

    ctxOverlay.restore();
  }

  // Render cached regions for hidden layers
  function renderCachedRegions() {
    for (const layer of state.layers) {
      if (!layer.visible && layer.cachedRegion && layer.cachedRegion.canvas) {
        // Only render if the region hasn't already been rendered
        if (!layer._regionRendered) {
          showCachedRegion(layer);
          layer._regionRendered = true;
        }
      } else {
        // Reset the rendered flag if layer is visible
        if (layer._regionRendered) {
          layer._regionRendered = false;
        }
      }
    }
  }

  function nextLayerColor() {
    return LAYER_COLORS[state.layers.length % LAYER_COLORS.length];
  }

  function updateHud() {
    hudImgSize.textContent = state.imgW + '×' + state.imgH;
    hudZoom.textContent = Math.round(state.zoom * 100) + '%';
    if (state.hoverTile) {
      hudTile.textContent = state.hoverTile[0] + ', ' + state.hoverTile[1];
    } else if (state.selectedTile) {
      hudTile.textContent = state.selectedTile.tx + ', ' + state.selectedTile.ty;
    } else if (state.selectedTiles && state.selectedTiles.length > 0) {
      hudTile.textContent = state.selectedTiles.length + ' tiles selected';
    } else {
      hudTile.textContent = '—';
    }
  }

  // ---------------------------------------------------------------------
  // Tool switching
  // ---------------------------------------------------------------------
  function setTool(tool) {
    if (state.tool === 'mask' && tool !== 'mask' && state.drawingPoints.length) {
      // Abandon in-progress drawing if switching away without closing
      if (!confirm('Discard the mask you\'re currently drawing?')) return;
      state.drawingPoints = [];
      state.isDrawing = false;
    }
    state.tool = tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    stage.classList.remove('tool-select', 'tool-mask', 'tool-pan');
    stage.classList.add('tool-' + tool);

    if (tool === 'select') {
      statusTool.textContent = 'Tool: Select start tile';
      if (state.selectedTiles && state.selectedTiles.length > 0) {
        statusTool.textContent = 'Tool: Select multiple tiles';
        hintBox.innerHTML = `
          <div class="step"><span class="n">1</span><span>Hold <b>CTRL</b> and click tiles to add them to selection.</span></div>
          <div class="step"><span class="n">2</span><span>Press <b>Enter</b> to create a layer with all selected tiles.</span></div>
          <div class="step"><span class="n">3</span><span>Right-click a tile or press <b>R</b> to add the first selected tile as a layer.</span></div>`;
      } else {
        hintBox.innerHTML = `
          <div class="step"><span class="n">1</span><span>Click a diamond on the grid to set it as the <b>anchor / start tile</b> for the next part.</span></div>
          <div class="step"><span class="n">2</span><span>Switch to <b>Draw mask</b> and trace the region belonging to this anchor.</span></div>
          <div class="step"><span class="n">3</span><span>Right-click the selected tile or press <b>R</b> to add it as a layer immediately.</span></div>`;
      }
    } else if (tool === 'mask') {
      statusTool.textContent = 'Tool: Draw mask boundary';
      hintBox.innerHTML = `
        <div class="step"><span class="n">1</span><span>Click to place boundary points around the part you want to extract.</span></div>
        <div class="step"><span class="n">2</span><span>Double-click, press <b>Enter</b>, or click the first point again to close the shape.</span></div>
        <div class="step"><span class="n">3</span><span>Press <b>Esc</b> to cancel the current shape.</span></div>`;
    } else if (tool === 'pan') {
      statusTool.textContent = 'Tool: Pan';
      hintBox.innerHTML = `
        <div class="step"><span class="n">1</span><span>Click and drag to move the canvas. Scroll to zoom. Hold <b>Space</b> anytime to pan temporarily.</span></div>`;
    }
    renderAll();
  }

  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // ---------------------------------------------------------------------
  // Pointer interaction on stage
  // ---------------------------------------------------------------------
  let spaceHeld = false;
  let ctrlHeld = false;
  let lastToolBeforeSpace = null;

  function getStageMouse(e) {
    const rect = stage.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  // Context menu for right-click to add tile as layer
  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!state.img || state.tool !== 'select' || !state.selectedTile) return;
    
    const [sx, sy] = getStageMouse(e);
    const [wx, wy] = s2w(sx, sy);
    const [tx, ty] = pixelToTile(wx, wy);
    
    // Only show if clicking on the selected tile
    if (state.selectedTiles && state.selectedTiles.some(t => t.tx === tx && t.ty === ty)) {
      showSelectedTilesContextMenu(e.clientX, e.clientY);
    }
  });

  stage.addEventListener('mousemove', (e) => {
    if (!state.img) return;
    const [sx, sy] = getStageMouse(e);

    if (state.isPanning) {
      state.panX = state.panStart.panX + (sx - state.panStart.sx);
      state.panY = state.panStart.panY + (sy - state.panStart.sy);
      renderAll();
      return;
    }

    const [wx, wy] = s2w(sx, sy);

    if (state.tool === 'select') {
      const [tx, ty] = pixelToTile(wx, wy);
      state.hoverTile = [tx, ty];
      renderGrid();
      updateHud();
    } else if (state.tool === 'mask' && state.isDrawing) {
      let cwx = wx, cwy = wy;
      if (state.snapToTileCorners) {
        const snapped = nearestTileCorner(wx, wy);
        if (snapped) { cwx = snapped.x; cwy = snapped.y; }
      }
      // live preview segment to cursor
      renderOverlay();
      ctxOverlay.save();
      applyViewTransform(ctxOverlay);
      const last = state.drawingPoints[state.drawingPoints.length - 1];
      ctxOverlay.beginPath();
      ctxOverlay.moveTo(last.x, last.y);
      ctxOverlay.lineTo(cwx, cwy);
      ctxOverlay.strokeStyle = nextLayerColor();
      ctxOverlay.lineWidth = 1.5 / state.zoom;
      ctxOverlay.setLineDash([4 / state.zoom, 3 / state.zoom]);
      ctxOverlay.stroke();
      ctxOverlay.setLineDash([]);
      ctxOverlay.restore();
    }
  });

  stage.addEventListener('mouseleave', () => {
    state.hoverTile = null;
    if (state.img) { renderGrid(); updateHud(); }
  });

  stage.addEventListener('mousedown', (e) => {
    if (!state.img) return;
    const [sx, sy] = getStageMouse(e);

    if (state.tool === 'pan' || e.button === 1 || spaceHeld) {
      state.isPanning = true;
      state.panStart = { sx, sy, panX: state.panX, panY: state.panY };
      stage.classList.add('panning');
      e.preventDefault();
      return;
    }

    if (state.tool === 'select') {
      const [wx, wy] = s2w(sx, sy);
      const [tx, ty] = pixelToTile(wx, wy);
      
      if (e.button === 2) { // Right click
        // Show context menu for selected tiles
        if (state.selectedTiles && state.selectedTiles.some(t => t.tx === tx && t.ty === ty)) {
          showSelectedTilesContextMenu(e.clientX, e.clientY);
        }
        return;
      }
      
      if (ctrlHeld) {
        // Toggle tile selection (add if not selected, remove if already selected)
        if (!state.selectedTiles) state.selectedTiles = [];
        const tileIndex = state.selectedTiles.findIndex(t => t.tx === tx && t.ty === ty);
        if (tileIndex === -1) {
          // Add tile to selection set
          state.selectedTiles.push({ tx, ty });
          setStatusMsg('Tile added to selection (' + tx + ', ' + ty + '). Hold CTRL and click more tiles, or press Enter to create layer with selected tiles.');
        } else {
          // Remove tile from selection set
          state.selectedTiles.splice(tileIndex, 1);
          if (state.selectedTiles.length === 0) {
            setStatusMsg('All tiles deselected.');
          } else {
            setStatusMsg('Tile removed from selection (' + tx + ', ' + ty + '). Hold CTRL and click more tiles, or press Enter to create layer with selected tiles.');
          }
        }
        renderGrid();
        updateHud();
      } else {
        // Single tile selection (toggle behavior)
        if (state.selectedTile && state.selectedTile.tx === tx && state.selectedTile.ty === ty) {
          // Deselect if clicking the same tile
          state.selectedTile = null;
          state.selectedTiles = null;
          state.ctrlHeld = false;
          setStatusMsg('Tile deselected.');
        } else {
          // Select the tile
          state.selectedTile = { tx, ty };
          state.selectedTiles = [{ tx, ty }];
          setStatusMsg('Anchor tile set at (' + tx + ', ' + ty + '). Switch to Draw mask to trace this part, or hold CTRL and click more tiles to select multiple.');
        }
        renderGrid();
        updateHud();
      }
      return;
    }

    if (state.tool === 'mask') {
      const [wx, wy] = s2w(sx, sy);
      handleMaskClick(wx, wy);
    }
  });

  window.addEventListener('mouseup', () => {
    if (state.isPanning) {
      state.isPanning = false;
      stage.classList.remove('panning');
    }
  });

  stage.addEventListener('dblclick', (e) => {
    if (state.tool === 'mask' && state.isDrawing) {
      e.preventDefault();
      finalizeMask();
    }
  });

  stage.addEventListener('wheel', (e) => {
    if (!state.img) return;
    e.preventDefault();
    const [sx, sy] = getStageMouse(e);
    const factor = Math.pow(1.0015, -e.deltaY);
    setZoom(state.zoom * factor, sx, sy);
  }, { passive: false });

  // Context menu suppressed inside stage for cleaner right-drag-free workflow
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------------------------------------------------------------
  // Context menu for selected tiles
  function showSelectedTilesContextMenu(x, y) {
    if (!state.selectedTiles || state.selectedTiles.length === 0) return;
    
    // Remove any existing context menu
    const existingMenu = document.getElementById('selected-tiles-context-menu');
    if (existingMenu) existingMenu.remove();
    
    // Create context menu
    const menu = document.createElement('div');
    menu.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    
    // Clear selection menu item
    const clearItem = document.createElement('div');
    clearItem.style.cssText = `
      padding: 8px 12px;
      color: var(--text-0);
      cursor: pointer;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
    `;
    clearItem.textContent = 'Clear Selection';
    clearItem.onmouseover = () => clearItem.style.background = 'var(--bg-3)';
    clearItem.onmouseout = () => clearItem.style.background = 'transparent';
    clearItem.onclick = () => {
      state.selectedTiles = null;
      state.selectedTile = null;
      state.ctrlHeld = false;
      renderGrid();
      updateHud();
      setStatusMsg('Selection cleared.');
      menu.remove();
    };
    
    // Extract selection as layer menu item
    const extractItem = document.createElement('div');
    extractItem.style.cssText = `
      padding: 8px 12px;
      color: var(--text-0);
      cursor: pointer;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
    `;
    extractItem.textContent = 'Extract Selection as Layer';
    extractItem.onmouseover = () => extractItem.style.background = 'var(--bg-3)';
    extractItem.onmouseout = () => extractItem.style.background = 'transparent';
    extractItem.onclick = () => {
      addSelectedTilesAsLayer();
      menu.remove();
    };
    
    menu.appendChild(clearItem);
    menu.appendChild(extractItem);

    // "Select all art above" — only for single-tile selection
    if (state.selectedTiles && state.selectedTiles.length === 1) {
      const tile = state.selectedTiles[0];
      const artAboveItem = document.createElement('div');
      artAboveItem.style.cssText = `
        padding: 8px 12px;
        color: var(--text-0);
        cursor: pointer;
        border-radius: 4px;
        font-size: 12px;
        white-space: nowrap;
      `;
      artAboveItem.textContent = 'Select all art above';
      artAboveItem.onmouseover = () => artAboveItem.style.background = 'var(--bg-3)';
      artAboveItem.onmouseout = () => artAboveItem.style.background = 'transparent';
      artAboveItem.onclick = () => {
        selectArtAbove(tile.tx, tile.ty);
        menu.remove();
      };
      menu.appendChild(artAboveItem);
    }

    document.body.appendChild(menu);
    
    // Close menu when clicking elsewhere
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  function addTileAsLayer(tx, ty) {
    const color = nextLayerColor();
    const layer = {
      id: 'layer-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: 'Part ' + state.nextLayerNum,
      tile: { tx, ty },
      points: [],
      color,
      visible: true,
      cachedRegion: null,
    };
    state.nextLayerNum++;
    pushUndo();
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    
    // Extract and cache the masked region (empty mask = full image)
    layer.cachedRegion = extractAndCacheMaskedRegion(layer);
    
    // Set the rendered flag for new layers
    if (layer._regionRendered === undefined) {
      layer._regionRendered = false;
    }
    
    renderLayerList();
    renderAll();
    exportBtn.disabled = state.layers.length === 0;
    setStatusMsg('Created "' + layer.name + '". Select another tile to continue, or export when done.');
    toast('Layer "' + layer.name + '" created');
  }

  function addSelectedTilesAsLayer() {
    if (!state.selectedTiles || state.selectedTiles.length === 0) return;
    
    const selectedCount = state.selectedTiles.length;
    const color = nextLayerColor();
    const layer = {
      id: 'layer-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: 'Part ' + state.nextLayerNum,
      tile: { tx: state.selectedTiles[0].tx, ty: state.selectedTiles[0].ty },
      points: [],
      color,
      visible: true,
      cachedRegion: null,
    };
    state.nextLayerNum++;
    pushUndo();
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    
    // Extract and cache the masked region (empty mask = full image)
    layer.cachedRegion = extractAndCacheMaskedRegion(layer);
    
    // Set the rendered flag for new layers
    if (layer._regionRendered === undefined) {
      layer._regionRendered = false;
    }
    
    // Clear selection
    state.selectedTile = null;
    state.selectedTiles = null;
    state.ctrlHeld = false;
    
    renderLayerList();
    renderAll();
    exportBtn.disabled = state.layers.length === 0;
    setStatusMsg('Created "' + layer.name + '" with ' + selectedCount + ' selected tile' + (selectedCount > 1 ? 's' : '') + '. Select another tile to continue, or export when done.');
    toast('Layer "' + layer.name + '" created with ' + selectedCount + ' selected tile' + (selectedCount > 1 ? 's' : ''));
  }

  // ---------------------------------------------------------------------
  // Select all art above a tile — scans image pixels above the tile's
  // top edge, clips empty space, and creates a layer with the result.
  // ---------------------------------------------------------------------
  function selectArtAbove(tx, ty) {
    const bbox = scanArtAbove(tx, ty);
    if (!bbox) {
      toast('No art found above tile (' + tx + ', ' + ty + ').', true);
      return;
    }

    const color = nextLayerColor();
    const layer = {
      id: 'layer-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: 'Part ' + state.nextLayerNum,
      tile: { tx, ty },
      points: [
        { x: bbox.left, y: bbox.top },
        { x: bbox.right + 1, y: bbox.top },
        { x: bbox.right + 1, y: bbox.bottom },
        { x: bbox.left, y: bbox.bottom },
      ],
      color,
      visible: true,
      cachedRegion: null,
      _regionRendered: false,
    };
    state.nextLayerNum++;
    pushUndo();
    state.layers.push(layer);
    state.activeLayerId = layer.id;

    layer.cachedRegion = extractAndCacheMaskedRegion(layer);

    renderLayerList();
    renderAll();
    exportBtn.disabled = state.layers.length === 0;
    setStatusMsg('Created "' + layer.name + '" — art above tile (' + tx + ', ' + ty + '). Select another tile to continue, or export when done.');
    toast('Layer "' + layer.name + '" created — art above tile (' + tx + ', ' + ty + ')');
  }

  // ---------------------------------------------------------------------
  // Mask drawing logic
  // ---------------------------------------------------------------------
  const CLOSE_THRESHOLD_SCREEN_PX = 10;

  function handleMaskClick(wx, wy) {
    if (state.snapToTileCorners) {
      const snapped = nearestTileCorner(wx, wy);
      if (snapped) { wx = snapped.x; wy = snapped.y; }
    }
    if (!state.isDrawing) {
      state.isDrawing = true;
      state.drawingPoints = [{ x: wx, y: wy }];
      renderOverlay();
      setStatusMsg('Drawing mask… click to add points, double-click or Enter to close.');
      return;
    }
    // check proximity to first point (in screen px) to close
    const first = state.drawingPoints[0];
    const [fsx, fsy] = w2s(first.x, first.y);
    const [csx, csy] = w2s(wx, wy);
    const dist = Math.hypot(fsx - csx, fsy - csy);
    if (dist <= CLOSE_THRESHOLD_SCREEN_PX && state.drawingPoints.length >= 3) {
      finalizeMask();
      return;
    }
    state.drawingPoints.push({ x: wx, y: wy });
    renderOverlay();
  }

  function finalizeMask() {
    if (state.drawingPoints.length < 3) {
      toast('Draw at least 3 points to form a region.', true);
      return;
    }
    if (!state.selectedTile) {
      toast('Select an anchor tile first (Select tile tool).', true);
      state.isDrawing = false;
      state.drawingPoints = [];
      renderOverlay();
      return;
    }
    const color = nextLayerColor();
    const layer = {
      id: 'layer-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: 'Part ' + state.nextLayerNum,
      tile: { tx: state.selectedTile.tx, ty: state.selectedTile.ty },
      points: state.drawingPoints.map(p => ({ x: p.x, y: p.y })),
      color,
      visible: true,
      cachedRegion: null,
      _regionRendered: false,
    };
    state.nextLayerNum++;
    pushUndo();
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    
    // Extract and cache the masked region
    layer.cachedRegion = extractAndCacheMaskedRegion(layer);
    
    // Set the rendered flag for new layers
    if (layer._regionRendered === undefined) {
      layer._regionRendered = false;
    }

    state.isDrawing = false;
    state.drawingPoints = [];
    state.selectedTile = null;

    renderLayerList();
    renderAll();
    exportBtn.disabled = state.layers.length === 0;
    setStatusMsg('Created "' + layer.name + '". Select another tile to continue, or export when done.');
    toast('Layer "' + layer.name + '" created');
    setTool('select');
  }

  function cancelMaskDrawing() {
    if (state.isDrawing) {
      state.isDrawing = false;
      state.drawingPoints = [];
      renderOverlay();
      setStatusMsg('Mask drawing cancelled.');
    }
  }

  // ---------------------------------------------------------------------
  // Undo / redo (snapshot-based — simple & robust for this scale of data)
  // ---------------------------------------------------------------------
  function snapshotLayers() {
    return JSON.parse(JSON.stringify(state.layers));
  }
  function pushUndo() {
    state.undoStack.push(snapshotLayers());
    if (state.undoStack.length > 50) state.undoStack.shift();
    state.redoStack = [];
  }
  function undo() {
    if (!state.undoStack.length) { toast('Nothing to undo'); return; }
    state.redoStack.push(snapshotLayers());
    state.layers = state.undoStack.pop();
    if (!state.layers.find(l => l.id === state.activeLayerId)) {
      state.activeLayerId = state.layers.length ? state.layers[state.layers.length - 1].id : null;
    }
    renderLayerList();
    renderAll();
    exportBtn.disabled = state.layers.length === 0;
  }
  function redo() {
    if (!state.redoStack.length) { toast('Nothing to redo'); return; }
    state.undoStack.push(snapshotLayers());
    state.layers = state.redoStack.pop();
    renderLayerList();
    renderAll();
    exportBtn.disabled = state.layers.length === 0;
  }
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  // ---------------------------------------------------------------------
  // Layer list UI
  // ---------------------------------------------------------------------
  function renderLayerList() {
    layerCountEl.textContent = state.layers.length;
    layerListEl.innerHTML = '';

    if (!state.layers.length) {
      const empty = document.createElement('div');
      empty.className = 'layer-empty';
      empty.textContent = state.img
        ? 'No layers yet. Select a tile, then draw a mask to create one.'
        : 'Load an image to get started.';
      layerListEl.appendChild(empty);
      statusLayer.textContent = 'No layer selected';
      return;
    }

    // Render most-recent first, like Photoshop's top-of-stack-first convention
    const ordered = [...state.layers].slice().reverse();
    for (const layer of ordered) {
      const item = document.createElement('div');
      item.className = 'layer-item' + (layer.id === state.activeLayerId ? ' selected' : '');
      item.dataset.id = layer.id;

      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.style.borderColor = layer.color;
      const thumbCanvas = makeLayerThumbnail(layer);
      if (thumbCanvas) swatch.appendChild(thumbCanvas);

      const meta = document.createElement('div');
      meta.className = 'meta';
      const nameInput = document.createElement('input');
      nameInput.className = 'name';
      nameInput.value = layer.name;
      nameInput.addEventListener('change', () => { layer.name = nameInput.value || layer.name; });
      nameInput.addEventListener('click', (e) => e.stopPropagation());
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = 'anchor ' + layer.tile.tx + ',' + layer.tile.ty + ' · ' + layer.points.length + ' pts';
      meta.appendChild(nameInput);
      meta.appendChild(sub);

      const actions = document.createElement('div');
      actions.className = 'actions';

      const visBtn = document.createElement('button');
      visBtn.title = layer.visible ? 'Hide layer' : 'Show layer';
      visBtn.innerHTML = layer.visible
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7 11-7z"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a18.5 18.5 0 015.06-5.94M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 7 11 7a18.5 18.5 0 01-2.16 3.19M14.12 14.12a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>';
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        if (!layer.visible) {
          // When hiding, cache the extracted region
          if (!layer.cachedRegion) {
            layer.cachedRegion = extractAndCacheMaskedRegion(layer);
          }
          // Show the cached region
          showCachedRegion(layer);
        } else {
          // When showing, hide the cached region
          hideCachedRegion(layer);
        }
        renderLayerList();
        renderAll();
      });

      const dupBtn = document.createElement('button');
      dupBtn.title = 'Duplicate layer';
      dupBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      dupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pushUndo();
      const copy = JSON.parse(JSON.stringify(layer));
      copy.id = 'layer-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      copy.name = layer.name + ' copy';
      copy.cachedRegion = null; // Clear cached region for copy
      copy._regionRendered = false; // Reset rendered flag for copy
      state.layers.push(copy);
      state.activeLayerId = copy.id;
      renderLayerList();
      renderAll();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'danger';
      delBtn.title = 'Delete layer';
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('Delete layer "' + layer.name + '"?')) return;
        pushUndo();
        state.layers = state.layers.filter(l => l.id !== layer.id);
        if (state.activeLayerId === layer.id) {
          state.activeLayerId = state.layers.length ? state.layers[state.layers.length - 1].id : null;
        }
        // Clear cached region for deleted layer
        clearCachedRegion(layer.id);
        renderLayerList();
        renderAll();
        exportBtn.disabled = state.layers.length === 0;
      });

      actions.appendChild(visBtn);
      actions.appendChild(dupBtn);
      actions.appendChild(delBtn);

      item.appendChild(swatch);
      item.appendChild(meta);
      item.appendChild(actions);

      item.addEventListener('click', () => {
        state.activeLayerId = layer.id;
        renderLayerList();
        renderAll();
        statusLayer.textContent = 'Layer: ' + layer.name;
      });

      layerListEl.appendChild(item);
    }

    const active = state.layers.find(l => l.id === state.activeLayerId);
    statusLayer.textContent = active ? 'Layer: ' + active.name : 'No layer selected';
  }

  function makeLayerThumbnail(layer) {
    if (!state.img) return null;
    const bbox = polygonBBox(layer.points);
    if (!bbox) return null;
    const c = document.createElement('canvas');
    c.width = 60; c.height = 60;
    const ctx = c.getContext('2d');
    const { clipped } = extractMaskedImage(layer, bbox);
    if (!clipped) return null;
    const scale = Math.min(60 / clipped.width, 60 / clipped.height, 1) || 1;
    const dw = clipped.width * scale, dh = clipped.height * scale;
    ctx.drawImage(clipped, (60 - dw) / 2, (60 - dh) / 2, dw, dh);
    return c;
  }

  // ---------------------------------------------------------------------
  // Mask extraction (shared by thumbnails + export)
  // ---------------------------------------------------------------------
  function polygonBBox(points) {
    if (!points || !points.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    minX = Math.max(0, Math.floor(minX));
    minY = Math.max(0, Math.floor(minY));
    maxX = Math.min(state.imgW, Math.ceil(maxX));
    maxY = Math.min(state.imgH, Math.ceil(maxY));
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    return { x: minX, y: minY, w, h };
  }

  // Extract masked region from image and cache it
  function extractAndCacheMaskedRegion(layer) {
    if (!state.img) return null;
    
    // For layers with no points (empty mask), cache the entire image
    if (!layer.points || layer.points.length < 3) {
      const cacheKey = layer.id;
      if (extractedRegions[cacheKey]) return extractedRegions[cacheKey];
      
      const c = document.createElement('canvas');
      c.width = state.imgW; c.height = state.imgH;
      const ctx = c.getContext('2d');
      
      ctx.drawImage(state.img, 0, 0);
      
      const region = { canvas: c, bbox: { x: 0, y: 0, w: state.imgW, h: state.imgH } };
      extractedRegions[cacheKey] = region;
      return region;
    }
    
    const bbox = polygonBBox(layer.points);
    if (!bbox) return null;
    
    const cacheKey = layer.id;
    if (extractedRegions[cacheKey]) return extractedRegions[cacheKey];
    
    const c = document.createElement('canvas');
    c.width = bbox.w; c.height = bbox.h;
    const ctx = c.getContext('2d');
    
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(layer.points[0].x - bbox.x, layer.points[0].y - bbox.y);
    for (let i = 1; i < layer.points.length; i++) {
      ctx.lineTo(layer.points[i].x - bbox.x, layer.points[i].y - bbox.y);
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(state.img, -bbox.x, -bbox.y);
    ctx.restore();
    
    const region = { canvas: c, bbox };
    extractedRegions[cacheKey] = region;
    
    // Set the rendered flag for new regions
    if (layer._regionRendered === undefined) {
      layer._regionRendered = false;
    }
    
    return region;
  }

  // Clear cached regions for a layer
  function clearCachedRegion(layerId) {
    if (extractedRegions[layerId]) {
      delete extractedRegions[layerId];
    }
    
    // Clear all layers' rendered flags
    for (const layer of state.layers) {
      if (layer.id === layerId) {
        layer._regionRendered = false;
      }
    }
  }

  // Show cached region for a layer
  function showCachedRegion(layer) {
    if (!layer.cachedRegion || !layer.cachedRegion.canvas) return;
    
    const c = layer.cachedRegion.canvas;
    const bbox = layer.cachedRegion.bbox;
    
    // For entire image regions, just draw the cached region
    if (bbox.x === 0 && bbox.y === 0 && bbox.w === state.imgW && bbox.h === state.imgH) {
      ctxMask.save();
      applyViewTransform(ctxMask);
      ctxMask.drawImage(c, 0, 0);
      ctxMask.restore();
    } else {
      // Draw the region on the mask canvas
      ctxMask.save();
      applyViewTransform(ctxMask);
      ctxMask.drawImage(c, bbox.x, bbox.y);
      ctxMask.restore();
    }
  }

  // Hide cached region for a layer
  function hideCachedRegion(layer) {
    if (!layer.cachedRegion || !layer.cachedRegion.canvas) return;
    
    const bbox = layer.cachedRegion.bbox;
    
    // For entire image regions, clear the entire canvas
    if (bbox.x === 0 && bbox.y === 0 && bbox.w === state.imgW && bbox.h === state.imgH) {
      clearCtx(ctxMask, maskCanvas);
    } else {
      // Clear the region from the mask canvas
      ctxMask.save();
      applyViewTransform(ctxMask);
      ctxMask.clearRect(bbox.x, bbox.y, bbox.w, bbox.h);
      ctxMask.restore();
    }
    
    // Reset the rendered flag
    if (layer._regionRendered) {
      layer._regionRendered = false;
    }
  }

  // Returns { clipped: <canvas, cropped to bbox> } — the masked region only, alpha elsewhere
  function extractMaskedImage(layer, bbox) {
    const c = document.createElement('canvas');
    c.width = bbox.w; c.height = bbox.h;
    const ctx = c.getContext('2d');

    ctx.save();
    
    if (layer.points && layer.points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(layer.points[0].x - bbox.x, layer.points[0].y - bbox.y);
      for (let i = 1; i < layer.points.length; i++) {
        ctx.lineTo(layer.points[i].x - bbox.x, layer.points[i].y - bbox.y);
      }
      ctx.closePath();
      ctx.clip();
    }
    
    ctx.drawImage(state.img, -bbox.x, -bbox.y);
    ctx.restore();

    return { clipped: c };
  }

  // Full-size canvas (same dimensions as source image) containing only this layer's pixels
  function extractFullSizeLayer(layer) {
    const c = document.createElement('canvas');
    c.width = state.imgW; c.height = state.imgH;
    const ctx = c.getContext('2d');
    ctx.save();
    
    if (layer.points && layer.points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(layer.points[0].x, layer.points[0].y);
      for (let i = 1; i < layer.points.length; i++) ctx.lineTo(layer.points[i].x, layer.points[i].y);
      ctx.closePath();
      ctx.clip();
    }
    
    ctx.drawImage(state.img, 0, 0);
    ctx.restore();
    return c;
  }

  // ---------------------------------------------------------------------
  // Export — zip of PNGs + manifest.json
  // ---------------------------------------------------------------------
  function slugify(s) {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'layer';
  }

  async function exportLayers() {
    if (!state.layers.length) { toast('No layers to export yet.', true); return; }
    if (typeof JSZip === 'undefined') { toast('Export library failed to load. Check your connection.', true); return; }

    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting…';

    try {
      const zip = new JSZip();
      const manifest = {
        sourceImage: { width: state.imgW, height: state.imgH },
        grid: { tileWidth: state.tileW, tileHeight: state.tileH, offsetX: state.offX, offsetY: state.offY },
        layers: [],
      };

      const usedNames = new Set();
      for (let i = 0; i < state.layers.length; i++) {
        const layer = state.layers[i];
        const bbox = polygonBBox(layer.points);
        const fullCanvas = extractFullSizeLayer(layer);

        let baseName = slugify(layer.name);
        let fileName = baseName + '.png';
        let dupe = 1;
        while (usedNames.has(fileName)) { fileName = baseName + '-' + (++dupe) + '.png'; }
        usedNames.add(fileName);

        const blob = await new Promise(resolve => fullCanvas.toBlob(resolve, 'image/png'));
        zip.file(fileName, blob);

        const [anchorCx, anchorCy] = tileCenter(layer.tile.tx, layer.tile.ty);

        manifest.layers.push({
          file: fileName,
          name: layer.name,
          anchorTile: { tx: layer.tile.tx, ty: layer.tile.ty },
          anchorPixel: { x: Math.round(anchorCx), y: Math.round(anchorCy) },
          boundingBox: bbox,
          maskPoints: layer.points.map(p => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })),
        });
      }

      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'iso-slicer-export.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      toast('Exported ' + state.layers.length + ' layer' + (state.layers.length > 1 ? 's' : '') + ' to .zip');
    } catch (err) {
      console.error(err);
      toast('Export failed: ' + err.message, true);
    } finally {
      exportBtn.disabled = state.layers.length === 0;
      exportBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Export layers (.zip)`;
    }
  }
  exportBtn.addEventListener('click', exportLayers);

  // ---------------------------------------------------------------------
  // Grid controls wiring
  // ---------------------------------------------------------------------
  function syncGridControlsFromState() {
    twRange.value = state.tileW; twNum.value = state.tileW;
    thRange.value = state.tileH; thNum.value = state.tileH;
    oxRange.value = clamp(state.offX, -200, 200); oxNum.value = state.offX;
    oyRange.value = clamp(state.offY, -200, 200); oyNum.value = state.offY;
    scRange.value = state.imgScale; scNum.value = state.imgScale;
  }

  function bindPair(rangeEl, numEl, onChange, opts = {}) {
    const apply = (v) => {
      v = Number(v);
      if (Number.isNaN(v)) return;
      if (opts.min != null) v = Math.max(opts.min, v);
      if (opts.max != null) v = Math.min(opts.max, v);
      rangeEl.value = clamp(v, Number(rangeEl.min), Number(rangeEl.max));
      numEl.value = v;
      onChange(v);
    };
    rangeEl.addEventListener('input', () => apply(rangeEl.value));
    numEl.addEventListener('input', () => apply(numEl.value));
  }

  bindPair(twRange, twNum, (v) => { state.tileW = v; renderAll(); }, { min: 4 });
  bindPair(thRange, thNum, (v) => { state.tileH = v; renderAll(); }, { min: 2 });
  bindPair(oxRange, oxNum, (v) => { state.offX = v; renderAll(); });
  bindPair(oyRange, oyNum, (v) => { state.offY = v; renderAll(); });
  bindPair(scRange, scNum, (v) => { state.imgScale = v; renderAll(); }, { min: 0.1, max: 5 });

  gridVisibleChk.addEventListener('change', () => {
    state.showGrid = gridVisibleChk.checked;
    renderGrid();
  });

  const imgVisibleChk = document.getElementById('img-visible');
  imgVisibleChk.addEventListener('change', () => {
    state.imgVisible = imgVisibleChk.checked;
    renderBase();
  });

  const snapCornersChk = document.getElementById('snap-corners');
  snapCornersChk.addEventListener('change', () => {
    state.snapToTileCorners = snapCornersChk.checked;
    renderOverlay();
  });

  // ---------------------------------------------------------------------
  // Zoom buttons
  // ---------------------------------------------------------------------
  document.getElementById('zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.25));
  document.getElementById('zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.25));
  document.getElementById('zoom-reset').addEventListener('click', () => { fitToView(); renderAll(); });

  // ---------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input') return; // don't hijack typing in number fields / layer names

    if (e.code === 'Space' && !spaceHeld) {
      spaceHeld = true;
      lastToolBeforeSpace = state.tool;
      if (state.tool !== 'pan') {
        stage.classList.remove('tool-select', 'tool-mask', 'tool-pan');
        stage.classList.add('tool-pan');
      }
      e.preventDefault();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      ctrlHeld = true;
    }

    if (e.key === 'v' || e.key === 'V') { setTool('select'); }
    else if (e.key === 'm' || e.key === 'M') { setTool('mask'); }
    else if (e.key === 'h' || e.key === 'H') { setTool('pan'); }
    else if (e.key === 'Escape') { cancelMaskDrawing(); }
    else if (e.key === 'Enter') { if (state.tool === 'mask' && state.isDrawing) finalizeMask(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) { redo(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { undo(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { redo(); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') { setZoom(state.zoom * 1.25); }
    else if (e.key === '-' || e.key === '_') { setZoom(state.zoom / 1.25); }
    else if (e.key === 'r' || e.key === 'R') {
      if (state.tool === 'select' && (state.selectedTile || (state.selectedTiles && state.selectedTiles.length > 0))) {
        addSelectedTilesAsLayer();
        e.preventDefault();
      }
    }
    else if (e.key === 'Enter' && ctrlHeld && state.tool === 'select' && state.selectedTiles && state.selectedTiles.length > 0) {
      addSelectedTilesAsLayer();
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.ctrlKey || e.metaKey) {
      ctrlHeld = false;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceHeld = false;
      stage.classList.remove('tool-select', 'tool-mask', 'tool-pan');
      stage.classList.add('tool-' + (lastToolBeforeSpace || 'select'));
    }
  });

  // ---------------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------------
  const resizeObserver = new ResizeObserver(() => {
    resizeCanvases();
    renderAll();
  });
  resizeObserver.observe(stageWrap);

  // Initial setup
  resizeCanvases();

})();
