# Mirror Mirror 🦋 — finish the other half of the figure

A daily symmetry drill: the left half of a smooth figure hangs off a dashed
mirror line, and you freehand the right half — any number of strokes, then
**done ✓** (or *undo ↩* to drop the last stroke, *clear* to restart the
figure — no penalty). Three figures per round, each one curvier than the last.
Trains the measured-symmetry habit: checking distances from the line instead of
eyeballing the outline.

Scoring is honest geometry: your strokes are mirrored back across the line and
compared to the true curve with a symmetric point-to-segment chamfer distance.
The result is graded in a **pixel band** —

```
free  = max(0.4% × figure height, 2.5 px)      → still a clean 100
zero  = ArtDaily.ease() × max(7% × figure height, 16 px)
```

— and the round score is the mean of the three figures.

Both halves of that band were fixed in this pass:

* **The floors.** The band used to be a pure fraction of the figure's height
  with nothing under it. On a phone the figure was ~208px tall, so a 100
  demanded a **0.83px** mean error — sub-pixel, under a fingertip 30–45px
  wide — while the desktop player got 1.66px for the identical drill. The
  canvas is also taller now under 520px (the old 260px clamp floor was itself
  the difficulty spike, since every tolerance derives from the figure height).
* **The zero point.** It sat at 22.8px on the desktop, where an honest
  beginner's eyeball-mirror (15–25px mean error) scores 0–35 *on any hardware*.
  Widened to 7%, and eased per device: a mouse pivots at the wrist and cannot
  creep. An 18px honest mirror scored **9**; it now scores **48** on a pen and
  **75** on a mouse. Scores are only ever compared with your own history, and
  the HUD prints which hardware was graded for.

**Starting is forgiving.** Strokes still belong right of the mirror line —
tracing the given half would mirror to the far right and score ~0 — but the gate
is now `ArtDaily.startRadius(40)` wide (68px for a pen) and it *snaps*: a press
that lands short of the line slides onto it, and any sample that strays left is
pulled back. A screenless tablet aims at that line with its hand out of sight;
landing 10px wide used to produce a pen that simply did not draw.

**The ink budget no longer seizes the sheet.** It used to auto-score the figure
from inside `pointermove`, with the pointer still down and the overdrawn
scribble counted in the chamfer — and the only warning was a sentence in the
hint line that nobody concentrating on drawing ever read. Now it is a bar under
the figure you can watch drain, the budget is eased (a mouse is *forced* to
iterate), the first 20px of every stroke are free so a row of landmark marks
costs nothing, and running out simply stops taking ink and asks you to press
done ✓.

**Also fixed**: `done ✓` unlocks after 4 points instead of 12 and carries a
tooltip explaining the wait; `undo` says what it did; a pen pointer outranks a
palm that landed first; the window-level `pointerup` fallback the other drills
had is now here too (a lost capture used to wedge the figure until Clear), along
with `pointercancel` and `lostpointercapture`; coalesced pointer events keep a
120Hz sweep intact; `clear` and `new round` no longer sit flush against each
other; and the stylesheet suppresses the iOS long-press callout over the canvas,
double-tap zoom on the controls, and pull-to-refresh.

After every figure the true mirror is revealed in lilac over your attempt with
short whiskers marking your 2–3 widest misses. The reveal advances on its own,
or tap/Enter to skip ahead; pressing **new round** while the last figure's
reveal is still up banks that round rather than dropping it. Keyboard: Enter =
done / next, Backspace = undo.

## Run it

No build step, no dependencies:

```sh
python3 -m http.server 8080
# then visit http://localhost:8080
```

Part of [Art Daily](https://artdaily.sadeali.com/), a
[SadeAli](https://sadeali.com/) experiment.
