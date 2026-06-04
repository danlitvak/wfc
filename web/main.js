// Boots Pyodide, loads numpy + the wfc/ package, then drives the solver one
// observation at a time so the collapse animates on the canvas (Milestone 3).

const WFC_MODULES = [
  "__init__.py",
  "patterns.py",
  "adjacency.py",
  "solver.py",
  "render.py",
  "samples.py",
];

// Package lives one level up from web/ (repo-root/wfc/...).
const WFC_BASE = "../wfc";

// Python glue: a Session holds one solver and steps it incrementally, returning
// the current (partly collapsed) wave as a flat RGBA buffer each time.
const DRIVER = `
import numpy as np
from wfc import extract_patterns, build_adjacency, WFCSolver, Contradiction
from wfc.samples import SAMPLES, PALETTE
from wfc.render import render_rgb


class Session:
    def __init__(self, name, N, out_h, out_w, seed, symmetry):
        self.out_h, self.out_w = out_h, out_w
        self.base_seed = seed
        self.restarts = 0
        sample = SAMPLES[name]
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
        """Run up to n observations; auto-restart on a contradiction."""
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

Session
`;

const els = {
  status: document.getElementById("status"),
  run: document.getElementById("run"),
  play: document.getElementById("play"),
  step: document.getElementById("step"),
  speed: document.getElementById("speed"),
  canvas: document.getElementById("canvas"),
  sample: document.getElementById("sample"),
  n: document.getElementById("n"),
  h: document.getElementById("h"),
  w: document.getElementById("w"),
  seed: document.getElementById("seed"),
};
const ctx = els.canvas.getContext("2d");
const off = document.createElement("canvas");
const offCtx = off.getContext("2d");

let SessionClass = null;
let session = null;
let playing = false;
let dims = { w: 0, h: 0, patterns: 0 };

function setStatus(msg) {
  els.status.textContent = msg;
}

async function loadWfcPackage(pyodide) {
  pyodide.FS.mkdir("wfc");
  for (const name of WFC_MODULES) {
    const resp = await fetch(`${WFC_BASE}/${name}`);
    if (!resp.ok) throw new Error(`failed to fetch wfc/${name}: ${resp.status}`);
    pyodide.FS.writeFile(`wfc/${name}`, await resp.text());
  }
}

// Convert a Python uint8 numpy array (PyProxy) to a Uint8Array and free it.
function takeBytes(proxy) {
  const arr = proxy.toJs();
  proxy.destroy();
  return arr;
}

function draw(rgba) {
  const { w, h } = dims;
  off.width = w;
  off.height = h;
  offCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);

  const scale = Math.max(1, Math.floor(480 / w));
  els.canvas.width = w * scale;
  els.canvas.height = h * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, els.canvas.width, els.canvas.height);
}

function setPlaying(on) {
  playing = on;
  els.play.textContent = on ? "Pause" : "Play";
}

// One advance of the solver, then render. Returns true while work remains.
function advance(n) {
  const proxy = session.step(n);
  const r = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  draw(r.data);
  const restarts = r.restarts ? `, ${r.restarts} restart(s)` : "";
  if (r.done) {
    setStatus(`Done — ${dims.patterns} patterns${restarts}.`);
  } else {
    setStatus(`Collapsing… ${dims.patterns} patterns${restarts}.`);
  }
  return !r.done;
}

function frameLoop() {
  if (playing && session) {
    const more = advance(Number(els.speed.value));
    if (!more) setPlaying(false);
  }
  requestAnimationFrame(frameLoop);
}

function generate() {
  if (session) session.destroy();

  const name = els.sample.value;
  const N = Number(els.n.value);
  const h = Number(els.h.value);
  const w = Number(els.w.value);
  const seedRaw = els.seed.value;
  const seed = seedRaw === "" ? null : Number(seedRaw);

  session = SessionClass(name, N, h, w, seed, 1);
  dims = { w, h, patterns: session.num_patterns() };

  draw(takeBytes(session.frame())); // initial blurry (all-possible) state
  setStatus(`Ready — ${dims.patterns} patterns. Press Play.`);
  setPlaying(true);
}

function singleStep() {
  if (!session) return;
  setPlaying(false);
  advance(1);
}

async function main() {
  try {
    setStatus("Loading Pyodide…");
    const pyodide = await loadPyodide();

    setStatus("Loading numpy…");
    await pyodide.loadPackage("numpy");

    setStatus("Loading wfc package…");
    await loadWfcPackage(pyodide);
    SessionClass = pyodide.runPython(DRIVER);

    els.run.addEventListener("click", generate);
    els.play.addEventListener("click", () => setPlaying(!playing));
    els.step.addEventListener("click", singleStep);
    for (const b of [els.run, els.play, els.step]) b.disabled = false;

    requestAnimationFrame(frameLoop);
    generate(); // build a session and start animating on load
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  }
}

main();
