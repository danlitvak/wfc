// Boots Pyodide + numpy + the wfc/ package, then drives the existing Python
// overlapping WFC engine from the design-inspired browser UI.

const WFC_MODULES = [
  "__init__.py", "patterns.py", "adjacency.py",
  "solver.py", "render.py", "samples.py",
];
const WFC_BASE = "../wfc";

const DRIVER = `
import json
import numpy as np
from wfc import extract_patterns, build_adjacency, WFCSolver, Contradiction
from wfc.samples import SAMPLES, PALETTE
from wfc.render import render_rgb


class Session:
    def __init__(self, sample, N, out_h, out_w, seed, symmetry, palette):
        self.out_h, self.out_w = out_h, out_w
        self.base_seed = seed
        self.restarts = 0
        self.palette = np.asarray(palette, dtype=float)
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
        rgb = render_rgb(self.solver.wave, self.patterns, self.palette)
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
  statusLabel: document.getElementById("statusLabel"),
  statusSub: document.getElementById("statusSub"),
  enterHint: document.getElementById("enterHint"),
  run: document.getElementById("run"),
  reset: document.getElementById("reset"),
  play: document.getElementById("play"),
  playIcon: document.getElementById("playIcon"),
  step: document.getElementById("step"),
  speed: document.getElementById("speed"),
  speedValue: document.getElementById("speedValue"),
  canvas: document.getElementById("canvas"),
  sampleCanvas: document.getElementById("sample-canvas"),
  palette: document.getElementById("palette"),
  addColor: document.getElementById("addColor"),
  customColor: document.getElementById("customColor"),
  preset: document.getElementById("preset"),
  srows: document.getElementById("srows"),
  scols: document.getElementById("scols"),
  clear: document.getElementById("clear"),
  n: document.getElementById("n"),
  symmetry: document.getElementById("symmetry"),
  h: document.getElementById("h"),
  w: document.getElementById("w"),
  seed: document.getElementById("seed"),
  panel: document.getElementById("panel"),
  btnSettings: document.getElementById("btnSettings"),
  panelClose: document.getElementById("panelClose"),
};

const ctx = els.canvas.getContext("2d");
const off = document.createElement("canvas");
const offCtx = off.getContext("2d");
const sctx = els.sampleCanvas.getContext("2d");

let pyodide = null;
let SessionClass = null;
let PALETTE = [];
let SAMPLES = {};
let session = null;
let playing = false;
let landed = false;
let outputDpr = 1;
let lastRgba = null;
let dims = { w: 0, h: 0, patterns: 0 };

const editor = { rows: 8, cols: 8, grid: [], color: 1, cell: 24 };

function setStatus(label, sub = "", state = "resting") {
  els.status.dataset.state = state;
  document.body.classList.toggle("is-loading", state === "loading");
  els.statusLabel.textContent = label;
  els.statusSub.textContent = sub;
  if (els.enterHint && !landed) els.enterHint.textContent = sub || label;
}

function land() {
  if (landed) return;
  landed = true;
  document.body.classList.remove("booting");
  document.body.classList.add("landed");
}

function updatePlayIcon() {
  els.playIcon.innerHTML = playing
    ? '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>'
    : '<path d="M8 5v14l11-7z"></path>';
}

function setPlaying(on) {
  playing = Boolean(on && session);
  els.play.title = playing ? "Pause" : "Play";
  updatePlayIcon();
}

// ---- sample editor -------------------------------------------------------

function buildPalette() {
  els.palette.replaceChildren();
  PALETTE.forEach((rgb, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch" + (i === editor.color ? " active" : "");
    button.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    button.title = `colour ${i}`;
    button.addEventListener("click", () => {
      editor.color = i;
      buildPalette();
      land();
    });
    els.palette.appendChild(button);
  });
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function addCustomColor(hex) {
  const rgb = hexToRgb(hex);
  PALETTE.push(rgb);
  editor.color = PALETTE.length - 1;
  buildPalette();
  land();
}

function closeCustomSelects(except = null) {
  document.querySelectorAll(".select-shell.open").forEach((shell) => {
    if (shell === except) return;
    shell.classList.remove("open");
    shell.querySelector(".select-trigger")?.setAttribute("aria-expanded", "false");
  });
}

function renderCustomSelect(select) {
  const shell = select.closest(".select-shell");
  const trigger = shell?.querySelector(".select-trigger");
  const value = shell?.querySelector(".select-value");
  const menu = shell?.querySelector(".select-menu");
  if (!shell || !trigger || !value || !menu) return;

  const selected = select.selectedOptions[0] || select.options[0];
  value.textContent = selected ? selected.textContent : "";
  menu.replaceChildren();

  Array.from(select.options).forEach((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "select-option";
    item.textContent = option.textContent;
    item.dataset.value = option.value;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(option.value === select.value));
    item.addEventListener("click", () => {
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeCustomSelects();
    });
    menu.appendChild(item);
  });
}

function wireCustomSelect(select) {
  const shell = select.closest(".select-shell");
  const trigger = shell?.querySelector(".select-trigger");
  if (!shell || !trigger) return;

  trigger.addEventListener("click", () => {
    const open = !shell.classList.contains("open");
    closeCustomSelects(shell);
    shell.classList.toggle("open", open);
    trigger.setAttribute("aria-expanded", String(open));
  });

  select.addEventListener("change", () => renderCustomSelect(select));
  renderCustomSelect(select);
}

function editorDraw() {
  const { rows, cols, grid } = editor;
  const cell = Math.max(8, Math.floor(286 / Math.max(rows, cols)));
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

  sctx.strokeStyle = "rgba(255,255,255,0.10)";
  sctx.lineWidth = 1;
  for (let r = 0; r <= rows; r++) {
    sctx.beginPath();
    sctx.moveTo(0, r * cell + 0.5);
    sctx.lineTo(cols * cell, r * cell + 0.5);
    sctx.stroke();
  }
  for (let c = 0; c <= cols; c++) {
    sctx.beginPath();
    sctx.moveTo(c * cell + 0.5, 0);
    sctx.lineTo(c * cell + 0.5, rows * cell);
    sctx.stroke();
  }
}

function editorResize(rows, cols) {
  rows = Math.max(2, Math.min(24, Number(rows) || 8));
  cols = Math.max(2, Math.min(24, Number(cols) || 8));
  const old = editor.grid;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid.push([]);
    for (let c = 0; c < cols; c++) {
      grid[r].push(old[r] && old[r][c] != null ? old[r][c] : 0);
    }
  }
  editor.rows = rows;
  editor.cols = cols;
  editor.grid = grid;
  els.srows.value = rows;
  els.scols.value = cols;
  updateSampleSteppers();
  editorDraw();
}

function buildPresetOptions(defaultName) {
  els.preset.replaceChildren();
  for (const name of Object.keys(SAMPLES)) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    els.preset.appendChild(option);
  }
  els.preset.value = defaultName;
  renderCustomSelect(els.preset);
}

function editorLoadPreset(name) {
  const grid = SAMPLES[name];
  if (!grid) return;
  editor.rows = grid.length;
  editor.cols = grid[0].length;
  editor.grid = grid.map((row) => row.slice());
  els.srows.value = editor.rows;
  els.scols.value = editor.cols;
  updateSampleSteppers();
  editorDraw();
}

function updateSampleSteppers() {
  document.querySelectorAll("[data-sample-step]").forEach((button) => {
    const target = button.dataset.sampleStep;
    const delta = Number(button.dataset.delta);
    const value = target === "rows" ? editor.rows : editor.cols;
    const input = target === "rows" ? els.srows : els.scols;
    const min = Number(input.min);
    const max = Number(input.max);
    button.disabled = delta < 0 ? value <= min : value >= max;
  });
}

function stepSampleSize(target, delta) {
  const nextRows = target === "rows" ? editor.rows + delta : editor.rows;
  const nextCols = target === "cols" ? editor.cols + delta : editor.cols;
  editorResize(nextRows, nextCols);
  land();
}

let painting = false;
function paintAt(event) {
  const rect = els.sampleCanvas.getBoundingClientRect();
  const c = Math.floor((event.clientX - rect.left) / editor.cell);
  const r = Math.floor((event.clientY - rect.top) / editor.cell);
  if (r < 0 || r >= editor.rows || c < 0 || c >= editor.cols) return;
  if (editor.grid[r][c] !== editor.color) {
    editor.grid[r][c] = editor.color;
    editorDraw();
  }
}

function wireEditor() {
  const cv = els.sampleCanvas;
  cv.addEventListener("pointerdown", (event) => {
    painting = true;
    cv.setPointerCapture(event.pointerId);
    paintAt(event);
    land();
  });
  cv.addEventListener("pointermove", (event) => {
    if (painting) paintAt(event);
  });
  cv.addEventListener("pointerup", () => { painting = false; });
  cv.addEventListener("pointercancel", () => { painting = false; });

  els.preset.addEventListener("change", () => {
    editorLoadPreset(els.preset.value);
    land();
  });
  els.srows.addEventListener("change", () => editorResize(els.srows.value, editor.cols));
  els.scols.addEventListener("change", () => editorResize(editor.rows, els.scols.value));
  document.querySelectorAll("[data-sample-step]").forEach((button) => {
    button.addEventListener("click", () => {
      stepSampleSize(button.dataset.sampleStep, Number(button.dataset.delta));
    });
  });
  els.clear.addEventListener("click", () => {
    editor.grid = editor.grid.map((row) => row.map(() => 0));
    editorDraw();
    land();
  });
  els.addColor.addEventListener("click", () => {
    els.customColor.click();
  });
  els.customColor.addEventListener("change", () => {
    addCustomColor(els.customColor.value);
  });
}

// ---- output rendering ----------------------------------------------------

function resizeOutputCanvas() {
  const rect = els.canvas.getBoundingClientRect();
  outputDpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * outputDpr));
  const height = Math.max(1, Math.round(rect.height * outputDpr));
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
  ctx.setTransform(outputDpr, 0, 0, outputDpr, 0, 0);
  return { width: rect.width, height: rect.height };
}

function draw(rgba) {
  if (!rgba || !dims.w || !dims.h) return;
  lastRgba = new Uint8ClampedArray(rgba);

  off.width = dims.w;
  off.height = dims.h;
  offCtx.putImageData(new ImageData(lastRgba, dims.w, dims.h), 0, 0);

  const { width, height } = resizeOutputCanvas();
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#04060a";
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const scale = Math.max(width / dims.w, height / dims.h);
  const drawW = Math.ceil(dims.w * scale);
  const drawH = Math.ceil(dims.h * scale);
  const x = Math.floor((width - drawW) / 2);
  const y = Math.floor((height - drawH) / 2);
  ctx.drawImage(off, x, y, drawW, drawH);
}

function takeBytes(proxy) {
  const arr = proxy.toJs();
  proxy.destroy();
  return arr;
}

function advance(n) {
  if (!session) return false;
  const proxy = session.step(n);
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();

  draw(result.data);
  const restarts = result.restarts ? `, ${result.restarts} restart(s)` : "";
  const label = result.done ? "Collapsed" : "Running";
  const state = result.done ? "resting" : "running";
  setStatus(label, `${dims.patterns} patterns${restarts}`, state);
  return !result.done;
}

function frameLoop() {
  if (playing && session) {
    const keepGoing = advance(Number(els.speed.value));
    if (!keepGoing) setPlaying(false);
  }
  requestAnimationFrame(frameLoop);
}

function createSessionFromControls() {
  if (!SessionClass) return;
  if (session) {
    session.destroy();
    session = null;
  }

  const N = Number(els.n.value);
  const symmetry = Number(els.symmetry.value);
  const h = Number(els.h.value);
  const w = Number(els.w.value);
  const seedRaw = els.seed.value;
  const seed = seedRaw === "" ? null : Number(seedRaw);

  const pySample = pyodide.toPy(editor.grid);
  const pyPalette = pyodide.toPy(PALETTE);
  try {
    session = SessionClass(pySample, N, h, w, seed, symmetry, pyPalette);
  } catch (err) {
    setStatus("Error", err.message, "error");
    throw err;
  } finally {
    pySample.destroy();
    pyPalette.destroy();
  }

  dims = { w, h, patterns: session.num_patterns() };
}

function generate() {
  setStatus("Generating", "extracting patterns", "loading");
  createSessionFromControls();
  if (!session) return;
  draw(takeBytes(session.frame()));
  setStatus("Ready", `${dims.patterns} patterns`, "resting");
  setPlaying(true);
}

function goToStepZero() {
  land();
  setPlaying(false);
  setStatus("Resetting", "returning to step 0", "loading");
  createSessionFromControls();
  if (!session) return;
  draw(takeBytes(session.frame()));
  setStatus("Step 0", `${dims.patterns} patterns`, "resting");
}

function singleStep() {
  if (!session) return;
  land();
  setPlaying(false);
  advance(1);
}

// ---- boot and wiring -----------------------------------------------------

async function loadWfcPackage(py) {
  py.FS.mkdir("wfc");
  for (const name of WFC_MODULES) {
    const resp = await fetch(`${WFC_BASE}/${name}`);
    if (!resp.ok) throw new Error(`failed to fetch wfc/${name}: ${resp.status}`);
    py.FS.writeFile(`wfc/${name}`, await resp.text());
  }
}

function wireControls() {
  els.btnSettings.addEventListener("click", () => {
    els.panel.classList.toggle("open");
    land();
  });
  els.panelClose.addEventListener("click", () => els.panel.classList.remove("open"));
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".select-shell")) closeCustomSelects();
    if (!els.panel.classList.contains("open")) return;
    if (els.panel.contains(event.target) || els.btnSettings.contains(event.target)) return;
    els.panel.classList.remove("open");
  });

  els.run.addEventListener("click", () => {
    land();
    generate();
  });
  els.reset.addEventListener("click", goToStepZero);
  els.play.addEventListener("click", () => {
    land();
    setPlaying(!playing);
  });
  els.step.addEventListener("click", singleStep);
  els.speed.addEventListener("input", () => {
    els.speedValue.textContent = `${els.speed.value} steps/frame`;
  });

  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      land();
      setPlaying(!playing);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      singleStep();
    } else if (event.key === "Home") {
      event.preventDefault();
      goToStepZero();
    } else if (event.key.toLowerCase() === "g") {
      land();
      generate();
    }
  });

  ["wheel", "touchstart", "pointerdown", "keydown"].forEach((eventName) => {
    window.addEventListener(eventName, land, { once: true, passive: true });
  });
}

function wireReveal() {
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }
}

function enableControls() {
  for (const button of [els.run, els.reset, els.play, els.step]) button.disabled = false;
}

async function main() {
  try {
    wireControls();
    wireReveal();
    resizeOutputCanvas();
    window.addEventListener("resize", () => {
      resizeOutputCanvas();
      if (lastRgba) draw(lastRgba);
      editorDraw();
    });

    setStatus("Loading", "starting Pyodide", "loading");
    pyodide = await loadPyodide();

    setStatus("Loading", "loading numpy", "loading");
    await pyodide.loadPackage("numpy");

    setStatus("Loading", "loading WFC package", "loading");
    await loadWfcPackage(pyodide);
    SessionClass = pyodide.runPython(DRIVER);

    const meta = JSON.parse(pyodide.runPython("metadata()"));
    PALETTE = meta.palette;
    SAMPLES = meta.samples;

    buildPalette();
    wireEditor();
    buildPresetOptions("maze");
    wireCustomSelect(els.preset);
    wireCustomSelect(els.symmetry);
    editorLoadPreset("maze");
    enableControls();

    requestAnimationFrame(frameLoop);
    generate();
    setTimeout(land, 1800);
  } catch (err) {
    console.error(err);
    setStatus("Error", err.message, "error");
  }
}

main();
