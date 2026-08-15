/* ============================================================
   game.js — Mirror Mirror: finish the other half of the figure.
   A dashed vertical mirror axis splits the canvas. Each figure is
   the LEFT half of a smooth open curve (Catmull-Rom through random
   control points); the player freehands the mirrored RIGHT half in
   any number of strokes. Score = symmetric chamfer distance between
   the mirrored attempt and the reference curve (point-to-SEGMENT,
   so a perfect trace isn't charged for sampling gaps), normalized
   by the figure's height, with a small tolerance floor so 100 is
   genuinely reachable. Keeps the template skeleton: init → figure →
   input → score → reveal → ArtDaily.report. One theme-aware
   canvas, no libraries.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'symmetry';
  var FIGURES_PER_ROUND = 3;
  var REF_SAMPLES = 80;   /* smooth samples per reference curve */
  var SCORE_SAMPLES = 320; /* denser sampling of the same curve for the
                              chamfer's reverse pass */
  var MIN_POINTS = 12;    /* "done ✓" unlocks after this many drawn points */
  var RUNAWAY = 2.5;      /* auto-score past this × reference length … */
  var INK_WARN = 2.0;     /* … with a hint warning from this × onward */
  var REVEAL_MS = 2600;   /* reveal auto-advances; a tap/Enter skips it */
  var SCORE_D = 0.055;    /* normalized chamfer that maps to score 0 */
  var SCORE_D0 = 0.004;   /* tolerance floor (≈1.5px on a typical figure):
                             any mean error below this scores 100 */

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

  function mirrorStrokes(strokes, axisX) {
    var out = [], i;
    for (i = 0; i < strokes.length; i++) out.push(mirrorAcross(strokes[i], axisX));
    return out;
  }

  /* closest point on a polyline (segments, not just vertices) —
     kills the sampling floor that made 100 unreachable */
  function nearestOnPolyline(p, poly) {
    var bx = poly[0].x, by = poly[0].y, best = Infinity;
    var i, a, b, abx, aby, len2, t, qx, qy, dx, dy, d2;
    if (poly.length === 1) {
      dx = p.x - bx; dy = p.y - by;
      return { x: bx, y: by, d: Math.sqrt(dx * dx + dy * dy) };
    }
    for (i = 0; i < poly.length - 1; i++) {
      a = poly[i]; b = poly[i + 1];
      abx = b.x - a.x; aby = b.y - a.y;
      len2 = abx * abx + aby * aby;
      t = len2 > 0 ? clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1) : 0;
      qx = a.x + t * abx; qy = a.y + t * aby;
      dx = p.x - qx; dy = p.y - qy;
      d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; bx = qx; by = qy; }
    }
    return { x: bx, y: by, d: Math.sqrt(best) };
  }

  function nearestOnStrokes(p, strokes) {
    var best = null, i, q;
    for (i = 0; i < strokes.length; i++) {
      if (strokes[i].length === 0) continue;
      q = nearestOnPolyline(p, strokes[i]);
      if (best === null || q.d < best.d) best = q;
    }
    return best;
  }

  /* symmetric chamfer: both directions count, so skipping a whole
     section of the curve hurts as much as scribbling far off it.
     Player side is a set of polylines (strokes), reference is one. */
  function chamferStrokes(strokes, refPoly) {
    var sumP = 0, nP = 0, sumR = 0, i, j, q;
    /* guard first: nearestOnPolyline dereferences refPoly[0] */
    if (refPoly.length === 0) return Infinity;
    for (i = 0; i < strokes.length; i++) {
      for (j = 0; j < strokes[i].length; j++) {
        sumP += nearestOnPolyline(strokes[i][j], refPoly).d;
        nP += 1;
      }
    }
    if (nP === 0) return Infinity;
    for (i = 0; i < refPoly.length; i++) {
      q = nearestOnStrokes(refPoly[i], strokes);
      sumR += q === null ? Infinity : q.d;
    }
    return (sumP / nP + sumR / refPoly.length) / 2;
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
     against the reference curve, normalize by figure height so canvas
     size and DPI never change the grade. 0 at d ≥ SCORE_D; anything
     under the SCORE_D0 floor is a clean 100 (GAME_GUIDE: a score of
     100 must be possible). */
  function scoreFigure(playerStrokes, refPts, axisX, figHeight) {
    var n = 0, i;
    for (i = 0; i < playerStrokes.length; i++) n += playerStrokes[i].length;
    if (n === 0 || refPts.length === 0 || figHeight <= 0) return 0;
    var d = chamferStrokes(mirrorStrokes(playerStrokes, axisX), refPts) / figHeight;
    return Math.round(100 * clamp(1 - Math.max(0, d - SCORE_D0) / (SCORE_D - SCORE_D0), 0, 1));
  }

  /* The 2–3 places the eye misjudged worst: for each drawn point,
     distance to the true mirror (reference reflected to the right);
     returns the top `count` misses, `minSep` px apart, as whisker
     segments {px,py → qx,qy} in right-half canvas coordinates. */
  function worstDeviations(playerStrokes, refPts, axisX, count, minSep, figHeight) {
    var dMin = Math.max(3, 0.008 * figHeight);
    var cands = [], i, j, p, pm, q;
    if (refPts.length === 0) return [];
    for (i = 0; i < playerStrokes.length; i++) {
      for (j = 0; j < playerStrokes[i].length; j++) {
        p = playerStrokes[i][j];
        pm = { x: 2 * axisX - p.x, y: p.y };
        q = nearestOnPolyline(pm, refPts);
        if (q.d >= dMin) {
          cands.push({ px: p.x, py: p.y, qx: 2 * axisX - q.x, qy: q.y, d: q.d });
        }
      }
    }
    cands.sort(function (a, b) { return b.d - a.d; });
    var out = [], k, ok;
    for (i = 0; i < cands.length && out.length < count; i++) {
      ok = true;
      for (k = 0; k < out.length; k++) {
        if (Math.hypot(cands[i].px - out[k].px, cands[i].py - out[k].py) < minSep) { ok = false; break; }
      }
      if (ok) out.push(cands[i]);
    }
    return out;
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
    /* n < 2 would make i/(n-1) a 0/0 NaN index */
    if (n < 2) return n < 1 ? [] : [{ x: ctrl[0].x, y: ctrl[0].y }];
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
  var btnUndo = document.getElementById('btnUndo');
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
  var drawnLen = 0, drawnPts = 0, inkWarned = false;
  var whiskers = [];
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
    inkWarned = false;
    whiskers = [];
    phase = 'draw';
    updateButtons();
    hint.textContent = 'Figure ' + (i + 1) + ' of ' + FIGURES_PER_ROUND + ' — draw the mirrored right half, then press done ✓.';
    draw();
  }

  function newRound() {
    clearTimeout(revealTimer);
    /* "new round" pressed while the LAST figure's reveal is still up: all
       three figures were scored, so the round *is* finished — bank it before
       resetting. Every completed round reaches ArtDaily.report exactly once
       (finishRound then flips phase to 'done', so this can't fire twice). */
    if (phase === 'reveal' && figScores.length === FIGURES_PER_ROUND) finishRound();
    round += 1;
    figIdx = 0;
    figScores = [];
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    makeFigure(0);
  }

  function countPoints(list) {
    var n = 0, i;
    for (i = 0; i < list.length; i++) n += list[i].length;
    return n;
  }

  function scoreCurrent() {
    if (phase !== 'draw') return;
    phase = 'reveal';
    activeStroke = null;
    activePointer = null;
    updateButtons();
    lastFigScore = scoreFigure(strokes, scoreRef, axisX, figH);
    figScores.push(lastFigScore);
    whiskers = worstDeviations(strokes, scoreRef, axisX, 3, 34, figH);
    hint.textContent = 'Figure ' + (figIdx + 1) + ': ' + lastFigScore + ' / 100 — bright line = true mirror, whiskers = widest misses.'
      + (figIdx + 1 < FIGURES_PER_ROUND ? ' tap for the next figure.' : ' tap to finish.');
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

  function recountInk() {
    var i;
    drawnLen = 0;
    for (i = 0; i < strokes.length; i++) drawnLen += polylineLength(strokes[i]);
    drawnPts = countPoints(strokes);
    if (drawnLen <= INK_WARN * refLen) inkWarned = false;
  }

  function undoStroke() {
    if (phase !== 'draw' || strokes.length === 0 || activePointer !== null) return;
    strokes.pop();
    recountInk();
    updateButtons();
    draw();
  }

  function clearFigure() {
    if (phase !== 'draw') return;
    strokes = [];
    activeStroke = null;
    activePointer = null;
    drawnLen = 0;
    drawnPts = 0;
    inkWarned = false;
    updateButtons();
    draw();
  }

  function updateButtons() {
    btnDone.disabled = !(phase === 'draw' && drawnPts >= MIN_POINTS);
    btnUndo.disabled = !(phase === 'draw' && strokes.length > 0);
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
    var i, w;
    for (i = 0; i < strokes.length; i++) strokePolyline(strokes[i], c.ink, 2.5);

    if (phase === 'reveal' || phase === 'done') {
      /* the truth, mirrored into the right half, over the attempt */
      strokePolyline(mirrorAcross(ref, axisX), c.accent, 3);
      /* whiskers: your stroke → the truth at the widest misses */
      for (i = 0; i < whiskers.length; i++) {
        w = whiskers[i];
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(w.px, w.py);
        ctx.lineTo(w.qx, w.qy);
        ctx.stroke();
        ctx.fillStyle = c.accent;
        ctx.beginPath();
        ctx.arc(w.px, w.py, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
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
    /* a tap during the reveal skips the wait */
    if (phase === 'reveal') {
      ev.preventDefault();
      clearTimeout(revealTimer);
      nextFigure();
      return;
    }
    if (phase !== 'draw' || activePointer !== null) return;
    ev.preventDefault();
    var p = pointerPos(ev);
    /* the left half is the given figure — tracing it would mirror to
       the far right and score ~0, so refuse strokes that start there */
    if (p.x < axisX - 6) {
      hint.textContent = 'draw on the RIGHT of the mirror line — the left half is the given figure.';
      return;
    }
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    activePointer = ev.pointerId;
    activeStroke = [p];
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
    if (!inkWarned && drawnLen > INK_WARN * refLen) {
      inkWarned = true;
      hint.textContent = 'ink running low — the figure auto-scores at 2.5× its own length. press done ✓ when ready.';
    }
    if (drawnLen > RUNAWAY * refLen) {
      /* ink budget spent: say why, then score */
      showToast('out of ink — figure auto-scored', false);
      scoreCurrent();
      return;
    }
    draw();
  });

  function endStroke(ev) {
    if (ev.pointerId !== activePointer) return;
    activePointer = null;
    activeStroke = null;
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  /* keyboard fallback on the focused canvas: Enter scores (or skips
     the reveal), Backspace/Delete undoes the last stroke */
  canvas.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && phase === 'reveal') {
      ev.preventDefault();
      clearTimeout(revealTimer);
      nextFigure();
    } else if (ev.key === 'Enter' && !btnDone.disabled) {
      ev.preventDefault();
      scoreCurrent();
    } else if ((ev.key === 'Backspace' || ev.key === 'Delete') && !btnUndo.disabled) {
      ev.preventDefault();
      undoStroke();
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
  btnUndo.addEventListener('click', undoStroke);
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
      var sx = W / oldW, sy = H / oldH, i, w;
      axisX *= sx;
      scalePts(ref, sx, sy);
      scalePts(scoreRef, sx, sy);
      for (i = 0; i < strokes.length; i++) scalePts(strokes[i], sx, sy);
      for (i = 0; i < whiskers.length; i++) {
        w = whiskers[i];
        w.px *= sx; w.py *= sy; w.qx *= sx; w.qy *= sy;
      }
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
