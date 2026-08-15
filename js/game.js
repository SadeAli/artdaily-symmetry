/* ============================================================
   game.js — Mirror Mirror: finish the other half of the figure.
   A dashed vertical mirror axis splits the canvas. Each figure is
   the LEFT half of a smooth open curve (Catmull-Rom through random
   control points); the player freehands the mirrored RIGHT half in
   any number of strokes. Score = symmetric chamfer distance between
   the mirrored attempt and the reference curve (point-to-SEGMENT,
   so a perfect trace isn't charged for sampling gaps), graded in a
   pixel band that scales with the figure but never falls below an
   absolute floor. Keeps the template skeleton: init → figure →
   input → score → reveal → ArtDaily.report. One theme-aware
   canvas, no libraries.

   Hardware fairness (protocol v1 input profile):
     · the band's zero point is ArtDaily.ease()d and floored in px, so
       a phone's half-height figure is not silently graded twice as
       strictly as a desktop's (it needed 0.83px mean error for a 100);
     · the axis gate is ArtDaily.startRadius()d and SNAPS — a blind
       landing just left of the axis slides onto it instead of
       producing a pen that draws nothing;
     · the ink budget never seizes the sheet mid-stroke, is visible as
       a bar rather than a sentence, and lets short landmark marks —
       the technique the drill teaches — cost nothing.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'symmetry';
  var FIGURES_PER_ROUND = 3;
  var REF_SAMPLES = 80;   /* smooth samples per reference curve */
  var SCORE_SAMPLES = 320; /* denser sampling of the same curve for the
                              chamfer's reverse pass */
  var MIN_POINTS = 4;     /* "done ✓" unlocks after this many drawn points */
  var RUNAWAY = 2.5;      /* ink budget, × reference length, before easing */
  var LANDMARK_PX = 20;   /* the first 20px of any stroke are free ink, so a
                             row of landmark ticks costs nothing */
  var REVEAL_MS = 2600;   /* reveal auto-advances; a tap/Enter skips it */
  var PEN_LOCKOUT_MS = 700;

  /* The grading band, in pixels of mean chamfer error.

     It was 0.4%–5.5% of the figure's height with no floor. That did two
     things wrong at once. On a phone the figure is ~208px tall, so a
     100 demanded 0.83px of mean error — sub-pixel, under a fingertip
     30-45px wide — while the desktop player got 1.66px for the same
     drill. And even on the desktop the zero point sat at 22.8px, where
     an honest beginner's eyeball-mirror (15–25px) scores 0–35 on any
     hardware: a grading problem, not an equipment one.

     So the band is the LARGER of two things: the drill's own standard,
     relative to the figure, and what a hand on this hardware can
     physically be expected to hit, in absolute pixels — which is the
     part ArtDaily.ease() scales. What this drill grades is a judgement
     ("where is the mirror?"), and a mouse judges as well as a pen; what
     a mouse cannot do is land the mark it judged, and that is a pixel
     count. Widening the relative side as well is the other half of the
     fix, and it applies to everyone: the old zero point failed honest
     beginners on every device, not just the cheap ones. */
  var REL_FREE = 0.004, FREE_FLOOR_PX = 2.5;
  var REL_ZERO = 0.080, ZERO_FLOOR_PX = 16;

  /* ============================================================
     Pure scoring math — plain geometry in, 0–100 out. Nothing in
     this section touches the canvas or the DOM, so every function
     is unit-testable in isolation. `ease` is the multiplier from
     ArtDaily.ease(1): 1 pen, 2 mouse/trackpad, 1.5 finger.
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

  /* symmetric chamfer, in pixels: both directions count, so skipping a
     whole section of the curve hurts as much as scribbling far off it.
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

  /* The px band this figure is graded in: free = still a clean 100,
     zero = the score has run out. */
  function tolerancePx(figHeight, ease) {
    var e = ease > 0 ? ease : 1;
    var h = figHeight > 0 ? figHeight : 0;
    return {
      free: Math.max(REL_FREE * h, FREE_FLOOR_PX),
      zero: Math.max(REL_ZERO * h, e * ZERO_FLOOR_PX),
    };
  }

  /* Figure score: mirror the attempt onto the left half, chamfer it
     against the reference curve, grade the pixel result in the band
     above. A score of 100 must be possible on every device, so the
     free zone never drops below a couple of pixels. */
  function scoreFigure(playerStrokes, refPts, axisX, figHeight, ease) {
    var n = 0, i;
    for (i = 0; i < playerStrokes.length; i++) n += playerStrokes[i].length;
    if (n === 0 || refPts.length === 0 || !(figHeight > 0)) return 0;
    var d = chamferStrokes(mirrorStrokes(playerStrokes, axisX), refPts);
    if (!isFinite(d)) return 0;
    var t = tolerancePx(figHeight, ease);
    if (t.zero <= t.free) return d <= t.free ? 100 : 0;
    return Math.round(100 * clamp(1 - (d - t.free) / (t.zero - t.free), 0, 1));
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

  /* Ink actually spent: the first LANDMARK_PX of every stroke is free,
     so marking a row of heights before joining them — the method this
     drill exists to teach — cannot cost you the budget. */
  function inkSpent(strokes) {
    var total = 0, i, len;
    for (i = 0; i < strokes.length; i++) {
      len = polylineLength(strokes[i]);
      if (len > LANDMARK_PX) total += len - LANDMARK_PX;
    }
    return total;
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
      line: cs.getPropertyValue('--line').trim(),
      accent: cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--lilac').trim(),
    };
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ---- */
  var W = 0, H = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    /* taller than the demo template — the figures run top to bottom, and
       every tolerance in the drill derives from the figure's height, so a
       phone squeezing it to the old 260px floor was a stealth difficulty
       spike. On a narrow sheet the figure gets more page, not less. */
    H = Math.round(clamp(W * (W < 520 ? 1.05 : 0.75), 300, 520));
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* How far left of the axis a press is still a press. A screenless
     tablet aims at the axis with its hand out of sight; landing 10px
     wide used to produce a pen that simply did not draw. */
  function axisGate() { return ArtDaily.startRadius(40); }
  function easeFactor() { return ArtDaily.ease(1); }
  function inkBudget() { return ArtDaily.ease(RUNAWAY) * refLen; }

  /* ---- round / figure state ---- */
  var round = 0, figIdx = 0, figScores = [];
  var axisX = 0, ref = [], scoreRef = [], refLen = 0, figH = 0;
  var strokes = [], activeStroke = null, activePointer = null, activeType = null;
  var lastPenAt = -1e9;
  var drawnPts = 0, inkWarned = false, outOfInk = false;
  var whiskers = [];
  var phase = 'idle'; /* idle | draw | reveal | done */
  var lastFigScore = 0, revealTimer = null;

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  /* difficulty ramps within the round: later figures get more control
     points and wilder in-and-out swings. Figure 1 is deliberately a
     gentle sweep — the first score of a session has to be reachable or
     nobody stays for the second. */
  function figureParams(i) {
    if (i === 0) return { ctrl: 4, smooth: 0.62, xMin: 0.24, jitter: 0.14 };
    if (i === 1) return { ctrl: 6 + Math.floor(rand(0, 2)), smooth: 0.3, xMin: 0.12, jitter: 0.3 };
    return { ctrl: 8, smooth: 0.1, xMin: 0.08, jitter: 0.3 };
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
        y += rand(-p.jitter, p.jitter) * span / (p.ctrl - 1);
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
    activeType = null;
    drawnPts = 0;
    inkWarned = false;
    outOfInk = false;
    whiskers = [];
    phase = 'draw';
    updateButtons();
    hint.textContent = 'Figure ' + (i + 1) + ' of ' + FIGURES_PER_ROUND +
      ' — draw the mirror image on the right of the dashed line, then press done ✓.';
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
    activeType = null;
    updateButtons();
    lastFigScore = scoreFigure(strokes, scoreRef, axisX, figH, easeFactor());
    figScores.push(lastFigScore);
    whiskers = worstDeviations(strokes, scoreRef, axisX, 3, 34, figH);
    hint.textContent = 'Figure ' + (figIdx + 1) + ': ' + lastFigScore + ' / 100 — bright line = true mirror, whiskers = your widest misses.'
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
    var res = ArtDaily.report(figScores.length ? sum / figScores.length : 0);
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = 'Round done — press “new round” to go again.';
    showToast((res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100', res.isNewBest);
    draw();
  }

  function recountInk() {
    drawnPts = countPoints(strokes);
    if (inkSpent(strokes) <= inkBudget() * 0.8) { inkWarned = false; outOfInk = false; }
  }

  function undoStroke() {
    if (phase !== 'draw' || strokes.length === 0 || activePointer !== null) return;
    strokes.pop();
    recountInk();
    updateButtons();
    hint.textContent = 'Figure ' + (figIdx + 1) + ' — last stroke removed.';
    draw();
  }

  function clearFigure() {
    if (phase !== 'draw') return;
    strokes = [];
    activeStroke = null;
    activePointer = null;
    activeType = null;
    drawnPts = 0;
    inkWarned = false;
    outOfInk = false;
    updateButtons();
    draw();
  }

  function updateButtons() {
    var canDone = phase === 'draw' && drawnPts >= MIN_POINTS;
    btnDone.disabled = !canDone;
    /* a primary button that is silently dead in the first 30 seconds is
       a bounce — say what it is waiting for */
    btnDone.title = canDone ? 'score this figure' : 'draw a little of the mirror first';
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

  /* The ink budget as a bar you can watch drain, not a sentence in the
     hint line that a player concentrating on drawing never reads. */
  function drawInkBar(c) {
    var budget = inkBudget();
    if (!(budget > 0)) return;
    var used = clamp(inkSpent(strokes) / budget, 0, 1);
    var x = 12, y = H - 10, w = W - 24;
    ctx.save();
    /* the track is a decorative rail; the fill and its label are the marks
       that mean something, so both sit at full strength — --muted is 5.2:1
       on paper and 5.8:1 on the night sheet, --lilac 3.5:1 and 6.1:1 */
    ctx.fillStyle = c.line;
    ctx.fillRect(x, y, w, 5);
    ctx.fillStyle = used > 0.8 ? c.accent : c.muted;
    ctx.fillRect(x, y, w * used, 5);
    ctx.fillStyle = c.muted;
    ctx.font = '700 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(outOfInk ? 'out of ink' : 'ink', x, y - 5);
    ctx.restore();
  }

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    if (ref.length === 0) return;

    /* the mirror line */
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

    if (phase === 'draw') drawInkBar(c);

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

  /* Snap onto the mirror line: a sample that strays left of the axis is
     pulled back to it. Overshooting the axis by a few px mirrors to the
     WRONG side and reads as a huge error, which is a coordinate accident,
     not a drawing mistake. */
  function onRight(p) {
    return { x: p.x < axisX ? axisX : p.x, y: p.y };
  }

  function penWins(ev) {
    /* only a FINGER ever waits, and only while the pen is still talking;
       a mouse or an unknown pointer type is always allowed to draw */
    if (ev.pointerType !== 'touch') return true;
    return (ev.timeStamp || 0) - lastPenAt >= PEN_LOCKOUT_MS;
  }

  function abortStroke() {
    if (activePointer !== null) {
      try { canvas.releasePointerCapture(activePointer); } catch (e) {}
    }
    if (activeStroke !== null) {
      var idx = strokes.indexOf(activeStroke);
      if (idx >= 0) strokes.splice(idx, 1);
    }
    activeStroke = null;
    activePointer = null;
    activeType = null;
    recountInk();
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'pen') lastPenAt = ev.timeStamp || 0;
    /* a tap during the reveal skips the wait */
    if (phase === 'reveal') {
      ev.preventDefault();
      clearTimeout(revealTimer);
      nextFigure();
      return;
    }
    if (phase !== 'draw') return;
    if (activePointer !== null) {
      /* the palm got here first — let the pen take the stroke over */
      if (ev.pointerType === 'pen' && activeType !== 'pen') abortStroke();
      else return;
    }
    if (!penWins(ev)) return;
    ev.preventDefault();
    try { canvas.focus({ preventScroll: true }); } catch (e) {}
    if (outOfInk) {
      hint.textContent = 'out of ink for this figure — press done ✓ to score it, or undo ↩ / clear.';
      return;
    }
    var p = pointerPos(ev);
    /* The left half is the figure you are copying: tracing it would
       mirror to the far right and score ~0. But the gate is generous and
       it snaps — a press up to a hand's width left of the line slides
       onto it rather than producing a pen that does nothing. */
    if (p.x < axisX - axisGate()) {
      hint.textContent = 'draw on the RIGHT of the dashed line — the left half is the figure you are copying.';
      return;
    }
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    activePointer = ev.pointerId;
    activeType = ev.pointerType;
    activeStroke = [onRight(p)];
    strokes.push(activeStroke);
    drawnPts += 1;
    updateButtons();
    draw();
  });

  function addSample(p) {
    var last = activeStroke[activeStroke.length - 1];
    var q = onRight(p);
    var d = Math.hypot(q.x - last.x, q.y - last.y);
    if (d < 2) return; /* thin the samples so the chamfer stays cheap */
    activeStroke.push(q);
    drawnPts += 1;
  }

  canvas.addEventListener('pointermove', function (ev) {
    if (ev.pointerType === 'pen') lastPenAt = ev.timeStamp || 0;
    if (phase !== 'draw' || activeStroke === null || ev.pointerId !== activePointer) return;
    ev.preventDefault();
    if (outOfInk) return;
    /* coalesced events: a 120Hz pen sweep keeps every sample */
    var evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null;
    if (evs && evs.length) {
      for (var i = 0; i < evs.length; i++) addSample(pointerPos(evs[i]));
    } else {
      addSample(pointerPos(ev));
    }
    updateButtons();
    var budget = inkBudget(), spent = inkSpent(strokes);
    if (!inkWarned && spent > budget * 0.8) {
      inkWarned = true;
      hint.textContent = 'ink running low — the bar under the figure shows what is left.';
    }
    if (!outOfInk && spent > budget) {
      /* Budget spent. Stop taking ink and SAY so — never score from
         inside a pointermove with the player's finger still down. */
      outOfInk = true;
      showToast('out of ink — press done ✓', false);
      hint.textContent = 'out of ink for this figure — press done ✓ to score it, or undo ↩ / clear and try again.';
    }
    draw();
  });

  function endStroke(ev) {
    if (ev.pointerId !== activePointer) return;
    activePointer = null;
    activeType = null;
    activeStroke = null;
    recountInk();
    updateButtons();
  }
  canvas.addEventListener('pointerup', endStroke);
  /* the other drills carry this and symmetry did not: without it a lost
     capture leaves the pointer id live and the figure wedged until Clear */
  window.addEventListener('pointerup', endStroke);
  canvas.addEventListener('lostpointercapture', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  window.addEventListener('pointercancel', endStroke);

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
  ArtDaily.onInput(function () { draw(); });

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
      recountInk();
    }
    draw();
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
