# Mirror Mirror 🦋 — finish the other half of the figure

A daily symmetry drill: the left half of a smooth figure hangs off a dashed
mirror axis, and you freehand the right half — any number of strokes, then
**done ✓** (or *clear* to restart the figure, no penalty). Three figures per
round, each one curvier than the last. Trains the measured-symmetry habit:
checking distances from the axis instead of eyeballing the contour.

Scoring is honest geometry: your strokes are mirrored back across the axis and
compared to the true curve with a symmetric chamfer distance, normalized by the
figure's height — figure score = 100 · clamp(1 − d/0.055). Round score is the
mean of the three figures; after every figure the true mirror is revealed in
lilac over your attempt so you can see the delta.

## Run it

No build step, no dependencies:

```sh
python3 -m http.server 8080
# then visit http://localhost:8080
```

Part of [Art Daily](https://artdaily.sadeali.com/), a
[SadeAli](https://sadeali.com/) experiment.
