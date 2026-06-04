// Boots Pyodide + numpy + the wfc/ package, lets the user paint a sample on the
// left, then animates the collapse on the right (Milestone 4).
//
// Model (per the project plan): painting only edits a local grid; clicking
// Generate re-extracts patterns/adjacency from that grid and restarts the solve.

const WFC_MODULES = [
  "__init__.py", "patterns.py", "adjacency.py",
  "solver.py", "render.py", "samples.py",
];
const WFC_BASE = "../wfc";

// Python glue: a Session is built from a raw sample grid and stepped frame by
// frame, returning the current (partly collapsed) wave as an RGBA buffer.
const DRIVER = `
import json
import numpy as np
from wfc import extract_patterns, build_adjacency, WFCSolver, Contradiction
from wfc.samples import SAMPLES, PALETTE
from wfc.render import render_rgb


class Session:
    def __init__(self, sample, N, out_h, out_w, seed, symmetry):
        self.out_h, self.out_w = out_h, out_w
        self.base_seed = seed
        self.restarts = 0
        sample = np.asarray(sample, dtype=int)
        self.patterns, self.weights = extract_patterns(
            sample, N=N, periodic_input=True, symmetry=symmetry)
        self.compatible = build_adjacency(self.patterns)
        self._new_solver(seed)

    def _new_solver(self, seed):
        self.solver = WFCSolver(
            self.patterns, self.weights, self.compatible,
            (self.out_h, self.out_w), seed=seed)

    def num_patterns(self):
        return int(len(self.patterns))

    def frame(self):
        rgb = render_rgb(self.solver.wave, self.patterns, PALETTE)
        rgba = np.empty((self.out_h, self.out_w, 4), dtype=np.uint8)
        rgba[..., :3] = rgb.astype(np.uint8)
        rgba[..., 3] = 255
        return rgba.reshape(-1)

    def step(self, n):
        for _ in range(n):
            if self.solver.done:
                break
            try:
                if self.solver.step() is None:
                    break
            except Contradiction:
                self.restarts += 1
                seed = None if self.base_seed is None else self.base_seed + self.restarts
                self._new_solver(seed)
                break
        return {"done": bool(self.solver.done),
                "restarts": int(self.restarts),
                "data": self.frame()}


def metadata():
    return json.dumps({
        "palette": [[int(x) for x in row] for row in PALETTE],
        "samples": {k: v.tolist() for k, v in SAMPLES.items()},
    })

Session
`;

const els = {
  status: document.getElementById("status"),
  run: document.getElementById("run"),
  play: document.getElementById("play"),
  step: document.getElementById("step"),
  speed: document.getElementById("speed"),
  canvas: document.getElementById("canvas"),
  sampleCanvas: document.getElementById("sample-canvas"),
  palette: document.getElementById("palette"),
  preset: document.getElementById("preset"),
  srows: document.getElementById("srows"),
  scols: document.getElementById("scols"),
  clear: document.getElementById("clear"),
  n: document.getElementById("n"),
  h: document.getElementById("h"),
  w: document.getElementById("w"),
  seed: document.getElementById("seed"),
};

const ctx = els.canvas.getContext("2d");
const off = document.createElement("canvas");
const offCtx = off.getContext("2d");
const sctx = els.sampleCanvas.getContext("2d");

let pyodide = null;
let SessionClass = null;
let PALETTE = [];            // [[r,g,b], ...]
let SAMPLES = {};            // { name: 2d grid }
let session = null;
let playing = false;
let dims = { w: 0, h: 0, patterns: 0 };

const editor = { rows: 8, cols: 8, grid: [], color: 1, cell: 24 };

function setStatus(msg) { els.status.textContent = msg; }

// ---- sample editor ----------------------------------------------------------

function buildPalette() {
  els.palette.replaceChildren();
  PALETTE.forEach((rgb, i) => {
    const b = document.createElement("button");
    b.className = "swatch" + (i === editor.color ? " active" : "");
    b.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    b.title = `colour ${i}`;
    b.addEventListener("click", () => { editor.color = i; buildPalette(); });
    els.palette.appendChild(b);
  });
}

function editorDraw() {
  const { rows, cols, grid } = editor;
  const cell = Math.max(8, Math.floor(240 / Math.max(rows, cols)));
  editor.cell = cell;
  const cv = els.sampleCanvas;
  cv.width = cols * cell;
  cv.height = rows * cell;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rgb = PALETTE[grid[r][c]] || [0, 0, 0];
      sctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      sctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
  sctx.strokeStyle = "rgba(255,255,255,0.08)";
  for (let r = 0; r <= rows; r++) {
    sctx.beginPath(); sctx.moveTo(0, r * cell); sctx.lineTo(cols * cell, r * cell); sctx.stroke();
  }
  for (let c = 0; c <= cols; c++) {
    sctx.beginPath(); sctx.moveTo(c * cell, 0); sctx.lineTo(c * cell, rows * cell); sctx.stroke();
  }
}

function editorResize(rows, cols) {
  const old = editor.grid;
  const g = [];
  for (let r = 0; r < rows; r++) {
    g.push([]);
    for (let c = 0; c < cols; c++) {
      g[r].push(old[r] && old[r][c] != null ? old[r][c] : 0);
    }
  }
  editor.rows = rows; editor.cols = cols; editor.grid = g;
  editorDraw();
}

function editorLoadPreset(name) {
  const g = SAMPLES[name];
  if (!g) return;
  editor.rows = g.length;
  editor.cols = g[0].length;
  editor.grid = g.map((row) => row.slice());
  els.srows.value = editor.rows;
  els.scols.value = editor.cols;
  editorDraw();
}

let painting = false;
function paintAt(e) {
  const rect = els.sampleCanvas.getBoundingClientRect();
  const c = Math.floor((e.clientX - rect.left) / editor.cell);
  const r = Math.floor((e.clientY - rect.top) / editor.cell);
  if (r < 0 || r >= editor.rows || c < 0 || c >= editor.cols) return;
  if (editor.grid[r][c] !== editor.color) {
    editor.grid[r][c] = editor.color;
    editorDraw();
  }
}

function wireEditor() {
  const cv = els.sampleCanvas;
  cv.addEventListener("pointerdown", (e) => {
    painting = true; cv.setPointerCapture(e.pointerId); paintAt(e);
  });
  cv.addEventListener("pointermove", (e) => { if (painting) paintAt(e); });
  cv.addEventListener("pointerup", () => { painting = false; });
  cv.addEventListener("pointercancel", () => { painting = false; });

  els.preset.addEventListener("change", () => {
    if (els.preset.value) editorLoadPreset(els.preset.value);
  });
  els.srows.addEventListener("change", () =>
    editorResize(Number(els.srows.value), editor.cols));
  els.scols.addEventListener("change", () =>
    editorResize(editor.rows, Number(els.scols.value)));
  els.clear.addEventListener("click", () => {
    editor.grid = editor.grid.map((row) => row.map(() => 0));
    editorDraw();
  });
}

// ---- output rendering -------------------------------------------------------

function draw(rgba) {
  const { w, h } = dims;
  off.width = w; off.height = h;
  offCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  const scale = Math.max(1, Math.floor(480 / w));
  els.canvas.width = w * scale;
  els.canvas.height = h * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, els.canvas.width, els.canvas.height);
}

function takeBytes(proxy) {
  const arr = proxy.toJs();
  proxy.destroy();
  return arr;
}

function setPlaying(on) {
  playing = on;
  els.play.textContent = on ? "Pause" : "Play";
}

function advance(n) {
  const proxy = session.step(n);
  const r = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  draw(r.data);
  const restarts = r.restarts ? `, ${r.restarts} restart(s)` : "";
  setStatus(`${r.done ? "Done" : "Collapsing…"} — ${dims.patterns} patterns${restarts}.`);
  return !r.done;
}

function frameLoop() {
  if (playing && session) {
    if (!advance(Number(els.speed.value))) setPlaying(false);
  }
  requestAnimationFrame(frameLoop);
}

function generate() {
  if (session) { session.destroy(); session = null; }

  const N = Number(els.n.value);
  const h = Number(els.h.value);
  const w = Number(els.w.value);
  const seedRaw = els.seed.value;
  const seed = seedRaw === "" ? null : Number(seedRaw);

  const pySample = pyodide.toPy(editor.grid);
  try {
    session = SessionClass(pySample, N, h, w, seed, 1);
  } finally {
    pySample.destroy();
  }

  dims = { w, h, patterns: session.num_patterns() };
  draw(takeBytes(session.frame()));   // initial all-possible state
  setStatus(`Ready — ${dims.patterns} patterns. Press Play.`);
  setPlaying(true);
}

function singleStep() {
  if (!session) return;
  setPlaying(false);
  advance(1);
}

// ---- boot -------------------------------------------------------------------

async function loadWfcPackage(py) {
  py.FS.mkdir("wfc");
  for (const name of WFC_MODULES) {
    const resp = await fetch(`${WFC_BASE}/${name}`);
    if (!resp.ok) throw new Error(`failed to fetch wfc/${name}: ${resp.status}`);
    py.FS.writeFile(`wfc/${name}`, await resp.text());
  }
}

async function main() {
  try {
    setStatus("Loading Pyodide…");
    pyodide = await loadPyodide();

    setStatus("Loading numpy…");
    await pyodide.loadPackage("numpy");

    setStatus("Loading wfc package…");
    await loadWfcPackage(pyodide);
    SessionClass = pyodide.runPython(DRIVER);

    const meta = JSON.parse(pyodide.runPython("metadata()"));
    PALETTE = meta.palette;
    SAMPLES = meta.samples;

    buildPalette();
    wireEditor();
    editorLoadPreset("maze");

    els.run.addEventListener("click", generate);
    els.play.addEventListener("click", () => setPlaying(!playing));
    els.step.addEventListener("click", singleStep);
    for (const b of [els.run, els.play, els.step]) b.disabled = false;

    requestAnimationFrame(frameLoop);
    generate();
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  }
}

main();
