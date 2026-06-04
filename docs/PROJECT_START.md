# WFC Visualizer — Project Start

An efficient, live-interactive **Wave Function Collapse** visualizer for the web.
The user paints a small sample on the left; the right side animates the WFC
output as it collapses, learning its rules from that sample.

## Goals & constraints

- **Language:** Python does the real work (the WFC engine).
- **Web:** runs in the browser, hosted on **GitHub Pages** (static files only).
- **Model:** **Overlapping** WFC — adjacency rules are learned automatically from a sample image.
- **Interactive & live:** user can edit the sample and watch the simulation collapse step by step.
- **Purpose:** personal learning project / portfolio piece.

## Architecture decision: Pyodide (chosen)

GitHub Pages can only serve static files, so it can't host a Python process.
We resolve "Python + GitHub Pages + live interactive" by running Python **in the
browser via Pyodide** (Python compiled to WebAssembly).

Why this fits:
- The WFC code stays **real Python**, and **Pyodide ships numpy**, so the
  efficient vectorized core works unchanged.
- **No network round-trips per collapse step** — the grid lives in browser
  memory and renders each frame, so animation stays smooth at thousands of steps.
- Zero hosting cost, no servers, no cold starts.

Trade-offs accepted:
- Not a "backend" in the literal sense.
- One-time ~few-MB WASM + numpy download on first page load.

Alternatives considered and rejected:
- **Real Python backend (FastAPI on Render/Fly/HF Spaces) + GitHub Pages frontend:**
  per-step animation would stream thousands of frames over the network (laggy),
  free tiers cold-start, more infra to babysit.
- **Backend returns only the finished result:** kills the live "watch it collapse" feel.

## Architecture

```
Browser (GitHub Pages, static)
├─ UI layer (HTML/CSS + a bit of JS)
│   ├─ Sample editor  (left): small pixel-grid you paint on
│   ├─ Output canvas  (right): WFC result animating
│   └─ Controls: grid size, N (pattern size), symmetry, run/step/reset, speed
└─ Pyodide (Python/WASM)
    └─ wfc/  ← pure Python package, the actual project
        ├─ patterns.py     extract N×N patterns + frequencies from sample
        ├─ adjacency.py    overlap-compatibility rules between patterns
        ├─ solver.py       entropy heuristic, observe/collapse, propagate (numpy)
        └─ render.py       current grid state → pixels for the canvas
```

The `wfc/` package is plain Python that also runs/tests from a normal terminal
with pytest — Pyodide is just the delivery mechanism.

## The overlapping algorithm

1. **Pattern extraction** — slide an N×N window over the sample, collect unique
   patterns + counts (optionally with rotations/reflections).
2. **Adjacency** — for each ordered pair of patterns and each offset, precompute
   "can A sit next to B" by checking the overlap agrees.
3. **Solve loop** — each output cell holds a boolean mask of still-possible
   patterns. Repeat: pick the min-entropy cell → collapse it to one pattern
   (weighted by frequency) → propagate constraints to neighbors until stable.
   Render the grid each iteration → animation.
4. **Contradiction handling** — if a cell's possibilities hit zero, restart
   (simpler than backtracking; can add backtracking later).

## Interactivity model

- Edit the sample → "Run" re-extracts patterns and restarts the solve.
- Step / play / pause / speed slider so you can watch propagation.
- Expensive recompute (patterns + adjacency) happens once per sample edit;
  per-frame cost is just the solve step + render.

## Open decisions (still to settle)

- **Sample editor target:** color-palette pixels (classic, simplest) vs. tile images.
- **Core implementation:** pure Python first (readable while learning) vs. numpy from the start (faster).

## Rough milestones

1. `wfc/` package + pytest, runs in a plain terminal on a hardcoded sample (no UI).
2. Static page + Pyodide loads the package, renders a final result.
3. Live stepping/animation on the output canvas.
4. Editable sample grid on the left + controls.
5. Polish: presets, symmetry options, deploy to GitHub Pages.
