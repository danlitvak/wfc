# Learning Log — WFC Visualizer

A running timeline of decisions, concepts learned, and gotchas as this project
develops. Newest entries at the bottom of each day. Intended as the portfolio
narrative: *what* we built, *why*, and *what I learned doing it*.

---

## 2026-06-03 — Project kickoff

**What happened**
- Read `PROJECT_START.md` and aligned on scope: a live, interactive
  **overlapping Wave Function Collapse** visualizer that learns adjacency rules
  from a user-painted sample and animates the collapse.

**Key concepts / decisions**
- **Overlapping WFC model** chosen (rules learned automatically from a sample
  image) over the simpler tiled model (hand-authored adjacency).
- **Pyodide** (Python → WebAssembly) chosen as the delivery mechanism so the
  real Python + numpy engine runs *in the browser* on static GitHub Pages —
  no server, no per-step network round-trips, smooth animation.
- The `wfc/` package will be plain Python, testable with pytest in a normal
  terminal. Pyodide is just how it ships to the web.

**Algorithm shape (overlapping WFC)**
1. Pattern extraction — slide an N×N window over the sample, collect unique
   patterns + frequencies (optionally rotations/reflections).
2. Adjacency — precompute per pattern-pair + offset whether the overlap agrees.
3. Solve loop — each cell holds a boolean mask of possible patterns; collapse
   min-entropy cell (weighted by frequency), propagate, render each iteration.
4. Contradiction handling — restart on a zeroed cell (backtracking later).

**Open questions to resolve**
- Sample editor target: color-palette pixels vs. tile images.
- Core implementation: pure Python first vs. numpy from the start.

**Next step**
- Begin Milestone 1: `wfc/` package + pytest on a hardcoded sample, terminal-only.

---

## 2026-06-03 — Milestone 1 complete: terminal WFC engine

**Decisions locked in**
- Core implementation: **numpy from the start** (boolean masks for the wave).
- Sample/editor unit: **color-palette pixels**.

**Toolchain**
- Python 3.12.6, numpy 2.2.5. Installed pytest 9.0.3.
- Run tests with `python -m pytest` (puts project root on `sys.path` so
  `import wfc` resolves; also avoids a Scripts-not-on-PATH warning).

**Built** (`wfc/` package, all plain Python + numpy):
- `patterns.py` — slide an N×N window (with edge wrap by default) to collect
  unique patterns + weights; optional D4 symmetry (1..8 variants per window).
- `adjacency.py` — `agrees(p1,p2,dr,dc)` overlap check → precomputed
  `compatible[4, T, T]` boolean table for the 4 cardinal directions.
- `solver.py` — `wave[r,c,t]` boolean possibility grid; observe (collapse the
  min-count cell, weighted random) + propagate (stack-based constraint ripple);
  `Contradiction` raised on a zeroed cell; `step()` exposed for future animation.
- `render.py` — wave → colour indices, or averaged RGB for the "blurry until
  resolved" look on undecided cells.
- `samples.py` — hardcoded `checker` and `maze` samples + palette.
- `run_demo.py` — terminal renderer using ANSI background colours.

**Verified**
- 11 pytest tests pass (pattern counts, adjacency agreement, deterministic
  seeded solve, checkerboard validity, done-state handling).
- `python run_demo.py maze --n 3 --size 14 28 --seed 7` → 44 patterns, solved
  in 88 observations, output shows coherent maze structure.

**Concepts learned / notes**
- *Overlapping WFC adjacency only needs the 4 cardinal directions* — the N×N
  overlap check across a unit shift already encodes longer-range agreement.
- The propagation core is one elegant numpy line: allowed neighbour patterns =
  `compatible[d][possible].any(axis=0)` — i.e. any pattern compatible with at
  least one still-possible pattern in the current cell.
- Used count-of-possibilities as a cheap entropy proxy (+ tiny noise for tie
  breaks); can upgrade to weighted Shannon entropy later if output looks biased.
- Contradictions handled by **restart** (the demo retries with a new seed),
  matching the project plan; backtracking is a later option.

**Next step**
- Milestone 2: static HTML page + Pyodide loads the `wfc/` package and renders a
  final result to a canvas. Watch for: how Pyodide picks up the package files,
  and numpy version parity with desktop (2.2.5 here).

---

## 2026-06-03 — Milestone 2 complete: Pyodide renders in the browser

**Built** (`web/`):
- `index.html` — controls (sample, N, height, width, seed) + a canvas + a status
  line. Loads Pyodide from the jsDelivr CDN.
- `style.css` — small dark UI.
- `main.js` — boots Pyodide, `loadPackage("numpy")`, copies the `wfc/*.py` files
  into Pyodide's in-memory FS, then runs a Python `solve()` driver that returns a
  flat RGBA buffer. JS draws it to an offscreen canvas and scales up with
  nearest-neighbour (`image-rendering: pixelated`).

**How the package gets into the browser**
- No build step / no wheel. `main.js` `fetch()`es each `wfc/*.py` over HTTP and
  `pyodide.FS.writeFile("wfc/<name>", src)` into the virtual filesystem, then
  imports normally. The page is at `/web/`, the package at `/wfc/`, so the fetch
  path is `../wfc/<name>`.
- Python → JS handoff: `solve()` returns a dict whose `data` is a 1-D uint8 numpy
  array; on the JS side `proxy.toJs({dict_converter: Object.fromEntries})` turns
  it into a plain object with `data` as a `Uint8Array`, wrapped in `ImageData`.
  Remember to `proxy.destroy()` the PyProxy.

**Concepts learned / notes**
- *Pyodide 0.27.7 ships numpy 2.0.2* (desktop here is 2.2.5). Version parity
  didn't matter — our code is plain numpy. Pyodide pins one numpy per release.
- Pyodide runs in **Node.js too**, which let me verify the whole Python path
  headlessly (no browser): boot → numpy → load package → `solve()` → check the
  RGBA buffer. Great for CI-style validation of the engine + glue.
- Security: pinned the CDN loader with Subresource Integrity
  (`integrity="sha384-…" crossorigin="anonymous"`). Note the loader still pulls
  `pyodide.asm.*` + the numpy wheel from the same CDN path un-pinned; SRI on the
  entry script is the practical mitigation.
- `setTimeout(…, 0)` before the (synchronous, blocking) solve lets the browser
  paint the "Solving…" / disabled-button state first.

**Verified**
- Headless Node + Pyodide 0.27.7: `solve("maze", N=3, 24×40, seed=7)` → 44
  patterns, RGBA buffer length 3840 (= 40·24·4), alpha all 255. Matches the
  desktop engine exactly.
- Local static server (`python -m http.server`): `web/index.html`, `main.js`,
  `style.css`, and `wfc/*.py` all serve 200 at the expected paths.

**Next step**
- Milestone 3: live stepping/animation. The solver already exposes `step()`; drive
  it from JS with `requestAnimationFrame` and re-render the (partly collapsed)
  wave each frame using `render_rgb`'s averaging for the "blurry until resolved"
  look.

---

## 2026-06-03 — Milestone 3 complete: live animated collapse

**Engine change**
- Vectorized `render_rgb` (was a per-cell Python double loop). New version:
  `counts = wave.sum(2)`, `summed = tensordot(wave, tl_rgb, ([2],[0]))`, then
  `summed / counts`. Same semantics (mean of possible patterns' colours) but
  fast enough to call every animation frame. Pinned with a new test against a
  reference loop (`tests/test_render.py`).

**Web change** (`web/`):
- Added a Python `Session` class to the driver: holds one solver, `step(n)`
  advances n observations and returns the current wave as an RGBA frame, and it
  **auto-restarts on `Contradiction`** (bumps the seed) so the animation never
  stalls.
- `main.js` now runs a permanent `requestAnimationFrame` loop. When "playing",
  each frame calls `session.step(speed)` and redraws. Controls: Generate
  (new session), Play/Pause, Step (single observation), Speed slider
  (observations per frame).
- The long-lived `Session` PyProxy is kept across frames and `.destroy()`ed when
  a new one is generated; per-step result dicts are converted then destroyed.

**Concepts learned / notes**
- The "blurry until resolved" look comes for free from averaging: a cell with k
  possible patterns shows the mean of their colours; as constraints prune k → 1
  the colour snaps to the final pixel. (The initial all-possible frame is a
  single flat colour — every cell averages the same full set.)
- Keep one PyProxy object alive for the session rather than recreating Python
  state each frame — cheaper and avoids re-extracting patterns/adjacency.
- Driving the solver from `requestAnimationFrame` (vs a blocking loop) keeps the
  page responsive and lets Pause/Step interrupt cleanly between frames.

**Verified**
- 14 pytest tests pass (added `test_render.py`: vectorized vs reference, exact
  colour on a collapsed cell, `render_indices`).
- Headless Node + Pyodide: `Session("maze", N=3, 24×40, seed=7)` animates to
  `done` in 24 frames at 6 steps/frame, 2 auto-restarts, final frame collapsed.

**Next step**
- Milestone 4: editable sample grid on the left + wire "edit sample → re-extract
  patterns → restart" so the user paints their own input. Expensive recompute
  (patterns + adjacency) happens once per edit; per-frame stays cheap.

---

## 2026-06-03 — Milestone 4 complete: paintable sample editor

**Web change** (`web/`):
- Three-panel layout: **Sample** editor (left), **Output** controls (middle),
  **Result** canvas (right).
- Sample editor on its own canvas: click/drag to paint with a palette picker,
  resize rows/cols (preserving overlap), load a preset, or Clear. Painting only
  mutates a local JS grid — no recompute per stroke.
- `Session` now takes a **raw sample grid** instead of a preset name. Generate
  reads the painted grid, re-extracts patterns + adjacency, and restarts the
  animation. This matches the plan's "edit → Run" model: the expensive step runs
  once per Generate, per-frame stays cheap.
- Added a Python `metadata()` returning the palette + presets as JSON, so JS gets
  them without juggling PyProxies.

**Concepts learned / notes**
- *Passing a JS nested array into Python:* a JS Array arrives as a `JsProxy`, not
  a Python `list`. Use `pyodide.toPy(grid)` to get a real list of lists that
  `np.asarray` accepts, then `.destroy()` the proxy once the Session has copied
  it into numpy.
- Pointer events (`pointerdown`/`move`/`up` + `setPointerCapture`) plus
  `touch-action: none` give click-and-drag painting that also works on touch.
- Keep the sample canvas at native pixel size (no CSS scaling) so
  `getBoundingClientRect` maps 1:1 to grid cells — simpler hit-testing.
- Security: clear child nodes with `replaceChildren()` rather than
  `innerHTML = ""` (no parsing, no XSS surface).

**Verified**
- Headless Node + Pyodide: Session built from (a) the maze preset → 44 patterns,
  (b) a custom 3-colour painted grid → 3 patterns, (c) a blank grid → 1 pattern;
  all animate to `done`. `metadata()` returns 4 palette colours + presets.

**Next step**
- Milestone 5 (polish + deploy): more presets, a symmetry control (the engine
  already supports `symmetry=1..8`), tidy UI, and deploy to GitHub Pages. For
  Pages, decide how the page finds `wfc/` (the `../wfc` fetch path) when served
  from the repo root or a `/docs` site root.
