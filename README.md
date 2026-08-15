# Mirror Mirror 🦋 — finish the other half of the figure

A daily symmetry drill: the left half of a smooth figure hangs off a dashed
mirror axis, and you freehand the right half — any number of strokes, then
**done ✓** (or *undo ↩* to drop the last stroke, *clear* to restart the
figure — no penalty). Strokes must start right of the axis; tracing the given
left half is refused with a hint instead of silently scoring zero. There is a
visible ink budget: past 2.5× the figure's own length the figure auto-scores,
with a warning from 2× onward. Three figures per round, each one curvier than
the last. Trains the measured-symmetry habit: checking distances from the axis
instead of eyeballing the contour.

Scoring is honest geometry: your strokes are mirrored back across the axis and
compared to the true curve with a symmetric point-to-segment chamfer distance,
normalized by the figure's height — figure score
= 100 · clamp(1 − max(0, d − 0.004)/(0.055 − 0.004)), so a careful mirror can
genuinely reach 100. Round score is the mean of the three figures; after every
figure the true mirror is revealed in lilac over your attempt with short
whiskers marking your 2–3 widest misses. The reveal advances on its own, or
tap/Enter to skip ahead; pressing **new round** while the last figure's reveal
is still up banks that round rather than dropping it. Keyboard: Enter = done /
next, Backspace = undo.

## Run it

No build step, no dependencies:

```sh
python3 -m http.server 8080
# then visit http://localhost:8080
```

Part of [Art Daily](https://artdaily.sadeali.com/), a
[SadeAli](https://sadeali.com/) experiment.
