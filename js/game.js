/* ============================================================
   game.js — Mirror Mirror: finish the other half of the figure.
   A dashed vertical mirror axis splits the canvas. Each figure is
   the LEFT half of a smooth open curve (Catmull-Rom through random
   control points); the player freehands the mirrored RIGHT half in
   any number of strokes. Score = symmetric chamfer distance between
   the mirrored attempt and the reference curve, normalized by the
   figure's height. Keeps the template skeleton: init → figure →
   input → score → reveal → ArtDaily.report. One theme-aware
   canvas, no libraries.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'symmetry';
  var FIGURES_PER_ROUND = 3;
  var REF_SAMPLES = 80;   /* smooth samples per reference curve */
  var SCORE_SAMPLES = 320; /* denser sampling of the same curve for the
                              chamfer, so a perfect trace isn't charged
                              for the gaps between the 80 drawn samples */
  var MIN_POINTS = 12;    /* "done ✓" unlocks after this many drawn points */
  var RUNAWAY = 2.5;      /* auto-score past this × reference length */
  var REVEAL_MS = 1800;
  var SCORE_D = 0.055;    /* normalized chamfer that maps to score 0 */

  /* ============================================================
     Pure scoring math — plain geometry in, 0–100 out. Nothing in
     this section touches the canvas or the DOM, so every function
     is unit-testable in isolation.
     ============================================================ */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* reflect a point set across the vertical axis x = axisX */
  function mirrorAcross(pts, axisX) {
    var out = [], i;
    for (i = 0; i < pts.length; i++) out.push({ x: 2 * axisX - pts[i].x, y: pts[i].y });
    return out;
  }

  function nearestDist(p, set) {
    var best = Infinity, i, dx, dy, d;
    for (i = 0; i < set.length; i++) {
      dx = set[i].x - p.x;
      dy = set[i].y - p.y;
      d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function meanNearest(a, b) {
    if (a.length === 0 || b.length === 0) return Infinity;
    var sum = 0, i;
    for (i = 0; i < a.length; i++) sum += nearestDist(a[i], b);
    return sum / a.length;
  }

  /* symmetric chamfer: both directions count, so skipping a whole
     section of the curve hurts as much as scribbling far off it */
  function chamferDist(P, R) {
    return (meanNearest(P, R) + meanNearest(R, P)) / 2;
  }

  function polylineLength(pts) {
    var len = 0, i;
    for (i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return len;
  }

  function pointsHeight(pts) {
    if (pts.length === 0) return 0;
    var lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < pts.length; i++) {
      if (pts[i].y < lo) lo = pts[i].y;
      if (pts[i].y > hi) hi = pts[i].y;
    }
    return hi - lo;
  }

  /* Figure score: mirror the attempt onto the left half, chamfer it
     against the reference samples, normalize by figure height so
     canvas size and DPI never change the grade. 0 at d ≥ SCORE_D,
     100 only at a (near-)perfect mirror. */
  function scoreFigure(playerPts, refPts, axisX, figHeight) {
    if (playerPts.length === 0 || refPts.length === 0 || figHeight <= 0) return 0;
    var d = chamferDist(mirrorAcross(playerPts, axisX), refPts) / figHeight;
    return Math.round(100 * clamp(1 - d / SCORE_D, 0, 1));
  }

  /* Catmull-Rom interpolation through control points (endpoints
     doubled for an open curve), resampled into n points */
  function crAxis(a, b, c, d, t) {
    return 0.5 * (2 * b + (c - a) * t
      + (2 * a - 5 * b + 4 * c - d) * t * t
      + (3 * b - a + d - 3 * c) * t * t * t);
  }

  function catmullRom(ctrl, n) {
    if (ctrl.length < 2) return ctrl.slice();
    var out = [], segs = ctrl.length - 1, i, u, s, t, p0, p1, p2, p3;
    for (i = 0; i < n; i++) {
      u = (i / (n - 1)) * segs;
      s = Math.min(segs - 1, Math.floor(u));
      t = u - s;
      p0 = ctrl[Math.max(0, s - 1)];
      p1 = ctrl[s];
      p2 = ctrl[s + 1];
      p3 = ctrl[Math.min(ctrl.length - 1, s + 2)];
      out.push({ x: crAxis(p0.x, p1.x, p2.x, p3.x, t), y: crAxis(p0.y, p1.y, p2.y, p3.y, t) });
    }
    return out;
  }

  /* ============================================================
     Canvas / DOM — everything below touches the page.
     ============================================================ */

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var btnDone = document.getElementById('btnDone');
  var btnClear = document.getElementById('btnClear');

  ArtDaily.init({ slug: SLUG });

  /* ---- theme-aware inks (re-read on every repaint) ---- */
  function inks() {
    var cs = getComputedStyle(document.documentElement);
    return {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      accent: cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--lilac').trim(),
    };
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ---- */
  var W = 0, H = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    /* taller than the demo template — the figures run top to bottom */
    H = Math.round(clamp(W * 0.75, 260, 520));
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- round / figure state ---- */
  var round = 0, figIdx = 0, figScores = [];
  var axisX = 0, ref = [], scoreRef = [], refLen = 0, figH = 0;
  var strokes = [], activeStroke = null, activePointer = null;
  var drawnLen = 0, drawnPts = 0;
  var phase = 'idle'; /* idle | draw | reveal | done */
  var lastFigScore = 0, revealTimer = null;

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  /* difficulty ramps within the round: later figures get more
     control points and wilder in-and-out swings (deeper concavities) */
  function figureParams(i) {
    if (i === 0) return { ctrl: 5, smooth: 0.5, xMin: 0.18 };
    if (i === 1) return { ctrl: 6 + Math.floor(rand(0, 2)), smooth: 0.3, xMin: 0.12 };
    return { ctrl: 8, smooth: 0.1, xMin: 0.08 };
  }

  function makeFigure(i) {
    var p = figureParams(i);
    axisX = W / 2;
    var top = H * 0.10, span = H * 0.80;
    var xMinPx = W * p.xMin, xMaxPx = W * 0.46;
    var ctrl = [], j, y;
    /* first and last control points sit on/near the axis so the two
       halves connect; interior x wanders the left half, top to bottom */
    var x = axisX - rand(0, W * 0.02);
    for (j = 0; j < p.ctrl; j++) {
      y = top + span * (j / (p.ctrl - 1));
      if (j > 0 && j < p.ctrl - 1) {
        y += rand(-0.3, 0.3) * span / (p.ctrl - 1);
        /* blend the previous x toward a fresh random one — high
           smoothing keeps early figures gentle */
        x = clamp(p.smooth * x + (1 - p.smooth) * rand(xMinPx, xMaxPx), xMinPx, xMaxPx);
      } else if (j === p.ctrl - 1) {
        x = axisX - rand(0, W * 0.02);
      }
      ctrl.push({ x: x, y: y });
    }
    ref = catmullRom(ctrl, REF_SAMPLES);
    scoreRef = catmullRom(ctrl, SCORE_SAMPLES);
    refLen = polylineLength(ref);
    figH = pointsHeight(scoreRef);
    strokes = [];
    activeStroke = null;
    activePointer = null;
    drawnLen = 0;
    drawnPts = 0;
    phase = 'draw';
    updateButtons();
    hint.textContent = 'Figure ' + (i + 1) + ' of ' + FIGURES_PER_ROUND + ' — draw the mirrored right half, then press done ✓.';
    draw();
  }

  function newRound() {
    clearTimeout(revealTimer);
    round += 1;
    figIdx = 0;
    figScores = [];
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    makeFigure(0);
  }

  function allPoints() {
    var out = [], i;
    for (i = 0; i < strokes.length; i++) out = out.concat(strokes[i]);
    return out;
  }

  function scoreCurrent() {
    if (phase !== 'draw') return;
    phase = 'reveal';
    activeStroke = null;
    activePointer = null;
    updateButtons();
    lastFigScore = scoreFigure(allPoints(), scoreRef, axisX, figH);
    figScores.push(lastFigScore);
    hint.textContent = 'Figure ' + (figIdx + 1) + ': ' + lastFigScore + ' / 100 — the bright line is the true mirror.';
    draw();
    revealTimer = setTimeout(nextFigure, REVEAL_MS);
  }

  function nextFigure() {
    figIdx += 1;
    if (figIdx < FIGURES_PER_ROUND) { makeFigure(figIdx); return; }
    finishRound();
  }

  function finishRound() {
    phase = 'done';
    updateButtons();
    var sum = 0, i;
    for (i = 0; i < figScores.length; i++) sum += figScores[i];
    var res = ArtDaily.report(sum / figScores.length);
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = 'Round done — press “new round” to go again.';
    showToast((res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100', res.isNewBest);
    draw();
  }

  function clearFigure() {
    if (phase !== 'draw') return;
    strokes = [];
    activeStroke = null;
    activePointer = null;
    drawnLen = 0;
    drawnPts = 0;
    updateButtons();
    draw();
  }

  function updateButtons() {
    btnDone.disabled = !(phase === 'draw' && drawnPts >= MIN_POINTS);
    btnClear.disabled = !(phase === 'draw' && strokes.length > 0);
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function strokePolyline(pts, color, width) {
    if (pts.length === 0) return;
    if (pts.length === 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, width, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    if (ref.length === 0) return;

    /* the mirror axis */
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(axisX, 6);
    ctx.lineTo(axisX, H - 6);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    /* reference left half + the player's attempt */
    strokePolyline(ref, c.ink, 2.5);
    var i;
    for (i = 0; i < strokes.length; i++) strokePolyline(strokes[i], c.ink, 2.5);

    if (phase === 'reveal' || phase === 'done') {
      /* the truth, mirrored into the right half, over the attempt */
      strokePolyline(mirrorAcross(ref, axisX), c.accent, 3);
      /* per-figure score flash */
      ctx.fillStyle = c.accent;
      ctx.font = '900 ' + Math.round(clamp(W * 0.07, 28, 44)) + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(lastFigScore), axisX + W * 0.27, H * 0.15);
    }
  }

  /* ---- input: freehand strokes on the right half ---- */
  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (phase !== 'draw' || activePointer !== null) return;
    ev.preventDefault();
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    activePointer = ev.pointerId;
    activeStroke = [pointerPos(ev)];
    strokes.push(activeStroke);
    drawnPts += 1;
    updateButtons();
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (phase !== 'draw' || activeStroke === null || ev.pointerId !== activePointer) return;
    ev.preventDefault();
    var p = pointerPos(ev);
    var last = activeStroke[activeStroke.length - 1];
    var d = Math.hypot(p.x - last.x, p.y - last.y);
    if (d < 2) return; /* thin the samples so the chamfer stays cheap */
    activeStroke.push(p);
    drawnLen += d;
    drawnPts += 1;
    updateButtons();
    if (drawnLen > RUNAWAY * refLen) { scoreCurrent(); return; } /* runaway guard */
    draw();
  });

  function endStroke(ev) {
    if (ev.pointerId !== activePointer) return;
    activePointer = null;
    activeStroke = null;
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  /* keyboard fallback on the focused canvas: Enter scores, Backspace clears */
  canvas.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !btnDone.disabled) {
      ev.preventDefault();
      scoreCurrent();
    } else if ((ev.key === 'Backspace' || ev.key === 'Delete') && !btnClear.disabled) {
      ev.preventDefault();
      clearFigure();
    }
  });

  /* ---- toast ---- */
  var toastTimer = null;
  function showToast(msg, celebrate) {
    toast.innerHTML = '';
    var s = document.createElement('span');
    s.className = celebrate ? 'toast-accent' : '';
    s.textContent = msg;
    toast.appendChild(s);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2200);
  }

  /* ---- chrome wiring ---- */
  document.getElementById('btnRound').addEventListener('click', newRound);
  btnDone.addEventListener('click', scoreCurrent);
  btnClear.addEventListener('click', clearFigure);

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);

  /* on resize, rescale the figure and strokes instead of resetting them */
  function scalePts(pts, sx, sy) {
    for (var i = 0; i < pts.length; i++) {
      pts[i].x *= sx;
      pts[i].y *= sy;
    }
  }

  window.addEventListener('resize', function () {
    var oldW = W, oldH = H;
    fitCanvas();
    if (oldW > 0 && oldH > 0 && (oldW !== W || oldH !== H)) {
      var sx = W / oldW, sy = H / oldH, i;
      axisX *= sx;
      scalePts(ref, sx, sy);
      scalePts(scoreRef, sx, sy);
      for (i = 0; i < strokes.length; i++) scalePts(strokes[i], sx, sy);
      refLen = polylineLength(ref);
      figH = pointsHeight(scoreRef);
      drawnLen = 0;
      for (i = 0; i < strokes.length; i++) drawnLen += polylineLength(strokes[i]);
    }
    draw();
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
