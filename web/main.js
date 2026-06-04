// Boots Pyodide, loads numpy and our wfc/ package, then renders a finished
// WFC result to the canvas. Milestone 2: produce a final image (no animation).

// wfc package modules, loaded into Pyodide's in-memory filesystem at startup.
const WFC_MODULES = [
  "__init__.py",
  "patterns.py",
  "adjacency.py",
  "solver.py",
  "render.py",
  "samples.py",
];

// The package lives one level up from web/ (repo-root/wfc/...).
const WFC_BASE = "../wfc";

// Python glue: imports the package and exposes a single solve() entry point
// that returns a dict with a flat RGBA byte buffer ready for canvas ImageData.
const DRIVER = `
import numpy as np
from wfc import extract_patterns, build_adjacency, WFCSolver, Contradiction
from wfc.samples import SAMPLES, PALETTE
from wfc.render import render_rgb


def solve(name, N, out_h, out_w, seed, symmetry, attempts):
    sample = SAMPLES[name]
    patterns, weights = extract_patterns(
        sample, N=N, periodic_input=True, symmetry=symmetry)
    compatible = build_adjacency(patterns)

    for attempt in range(attempts):
        s = None if seed is None else int(seed) + attempt
        solver = WFCSolver(patterns, weights, compatible, (out_h, out_w), seed=s)
        try:
            solver.run()
        except Contradiction:
            continue  # restart with a different seed
        rgb = render_rgb(solver.wave, patterns, PALETTE)
        rgba = np.empty((out_h, out_w, 4), dtype=np.uint8)
        rgba[..., :3] = rgb.astype(np.uint8)
        rgba[..., 3] = 255
        return {
            "ok": True,
            "patterns": int(len(patterns)),
            "attempt": attempt + 1,
            "data": rgba.reshape(-1),
        }
    return {"ok": False, "patterns": int(len(patterns))}

solve
`;

const statusEl = document.getElementById("status");
const runBtn = document.getElementById("run");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let solveFn = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function loadWfcPackage(pyodide) {
  pyodide.FS.mkdir("wfc");
  for (const name of WFC_MODULES) {
    const resp = await fetch(`${WFC_BASE}/${name}`);
    if (!resp.ok) {
      throw new Error(`failed to fetch wfc/${name}: ${resp.status}`);
    }
    pyodide.FS.writeFile(`wfc/${name}`, await resp.text());
  }
}

function draw(rgba, w, h) {
  // Render at native resolution on an offscreen canvas, then scale up with
  // nearest-neighbour so the pixels stay crisp.
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  off.getContext("2d").putImageData(
    new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);

  const scale = Math.max(1, Math.floor(480 / w));
  canvas.width = w * scale;
  canvas.height = h * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}

function generate() {
  const name = document.getElementById("sample").value;
  const N = Number(document.getElementById("n").value);
  const h = Number(document.getElementById("h").value);
  const w = Number(document.getElementById("w").value);
  const seedRaw = document.getElementById("seed").value;
  const seed = seedRaw === "" ? null : Number(seedRaw);

  runBtn.disabled = true;
  setStatus("Solving…");

  // Defer so the browser can paint the disabled/"Solving…" state first.
  setTimeout(() => {
    const t0 = performance.now();
    const proxy = solveFn(name, N, h, w, seed, 1, 20);
    const r = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy();
    const ms = Math.round(performance.now() - t0);

    if (r.ok) {
      draw(r.data, w, h);
      setStatus(
        `${name}: ${r.patterns} patterns, solved on attempt ${r.attempt} ` +
        `(${w}×${h} in ${ms} ms)`);
    } else {
      setStatus(`Gave up after contradictions — try a larger N or new seed.`);
    }
    runBtn.disabled = false;
  }, 0);
}

async function main() {
  try {
    setStatus("Loading Pyodide…");
    const pyodide = await loadPyodide();

    setStatus("Loading numpy…");
    await pyodide.loadPackage("numpy");

    setStatus("Loading wfc package…");
    await loadWfcPackage(pyodide);
    solveFn = pyodide.runPython(DRIVER);

    runBtn.addEventListener("click", generate);
    runBtn.disabled = false;
    setStatus("Ready — click Generate.");
    generate(); // render one result on load
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  }
}

main();
