/* ------------------------------------------------------------------
   app.js — wires the WFC engine + renderer to the page:
   controls, settings, palette editor, theme switch, landing, scroll.
------------------------------------------------------------------- */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const THEMES = Renderer.THEMES;
  const PROTO = window.WFC_PROTO;

  const canvas = $("#wfc-canvas");
  const renderer = new Renderer(canvas);

  // ---- state ----------------------------------------------------
  const DEFAULTS = {
    theme: "phosphor",
    grid: 28,
    speed: 120,
    density: 0.55,
    complexity: 0.4,
    heat: false,
    scan: true,
    loop: false,
  };
  const state = Object.assign({}, DEFAULTS, loadSaved());
  // per-theme working palettes (editable)
  const palettes = state.palettes || {};
  Object.keys(THEMES).forEach((t) => {
    if (!palettes[t]) palettes[t] = THEMES[t].palette.slice();
  });

  let wfc = null;
  let playing = false;
  let stepAcc = 0;
  let lastT = performance.now();
  let lastActivity = performance.now();
  let landed = false;

  // ---- weights from density / complexity ------------------------
  function weightsFor() {
    const d = state.density, c = state.complexity;
    return {
      empty: 2 + (1 - d) * 40,
      end: 0.3 + (1 - d) * 1.1,
      line: 5 + d * 3,
      elbow: 4 + d * 2,
      tee: 0.4 + c * 5,
      cross: 0.1 + c * 3,
    };
  }

  // ---- build / rebuild grid -------------------------------------
  let rT;
  function fit() {
    const r = canvas.getBoundingClientRect();
    renderer.resize(r.width, r.height);
  }
  function dims() {
    const w = renderer.cssW || canvas.getBoundingClientRect().width || window.innerWidth;
    const h = renderer.cssH || canvas.getBoundingClientRect().height || window.innerHeight;
    const cols = state.grid;
    const rows = Math.max(4, Math.round(cols * (h / w)));
    return { cols, rows };
  }

  function build(newSeed) {
    const { cols, rows } = dims();
    const seed = newSeed == null ? (Math.random() * 4294967296) >>> 0 : newSeed;
    wfc = new WFC(cols, rows, { weights: weightsFor(), seed });
    stepAcc = 0;
    lastActivity = performance.now();
    updateStatus();
  }

  // ---- main loop ------------------------------------------------
  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;

    if (playing && wfc && !wfc.done) {
      stepAcc += state.speed * dt;
      let n = Math.min(220, Math.floor(stepAcc));
      stepAcc -= n;
      let res = "progress";
      while (n-- > 0) {
        res = wfc.step(t);
        if (res === "contradiction") { build(); break; }
        if (res === "done") break;
      }
      lastActivity = t;
      if (wfc.done) {
        playing = false;
        updatePlayIcon();
        updateStatus();
        if (state.loop) setTimeout(() => { build(); play(); }, 1300);
      } else {
        updateStatus();
      }
    }

    // draw while active (covers glow/flash decay), idle otherwise
    if (playing || t - lastActivity < 720) {
      renderer.draw(wfc, state.theme, t);
    }
    requestAnimationFrame(frame);
  }

  // ---- controls -------------------------------------------------
  function play() { if (wfc && wfc.done) build(); playing = true; updatePlayIcon(); updateStatus(); lastActivity = performance.now(); }
  function pause() { playing = false; updatePlayIcon(); updateStatus(); }
  function togglePlay() { playing ? pause() : play(); }
  function stepOnce() {
    playing = false; updatePlayIcon();
    if (wfc.done) build();
    const r = wfc.step(performance.now());
    if (r === "contradiction") build();
    lastActivity = performance.now();
    updateStatus();
  }
  function generate() { build(); play(); land(); }

  function updatePlayIcon() {
    const ic = $("#playIcon");
    ic.innerHTML = playing
      ? '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>'
      : '<path d="M8 5v14l11-7z"></path>';
  }

  function updateStatus() {
    const st = $("#status");
    const total = wfc.mask.length;
    let label, sstate;
    if (wfc.contradiction) { label = "Contradiction"; sstate = "contradiction"; }
    else if (wfc.done) { label = "Collapsed"; sstate = "resting"; }
    else if (playing) { label = "Running"; sstate = "running"; }
    else { label = wfc.count > 0 ? "Paused" : "Resting"; sstate = "resting"; }
    st.dataset.state = sstate;
    $("#statusLabel").textContent = label;
    $("#statusSub").textContent = wfc.count + " / " + total + " cells";
  }

  // ---- landing --------------------------------------------------
  function land() {
    if (landed) return;
    landed = true;
    document.body.classList.remove("booting");
    document.body.classList.add("landed");
  }

  // ---- settings panel -------------------------------------------
  const panel = $("#panel");
  $("#btnSettings").addEventListener("click", () => panel.classList.toggle("open"));
  $("#panelClose").addEventListener("click", () => panel.classList.remove("open"));

  function bindSlider(id, valId, key, fmt, onCommit) {
    const el = $(id);
    el.value = state[key];
    $(valId).textContent = fmt(state[key]);
    el.addEventListener("input", () => {
      state[key] = parseFloat(el.value);
      $(valId).textContent = fmt(state[key]);
      onCommit();
      save();
    });
  }
  bindSlider("#sGrid", "#vGrid", "grid", (v) => v, () => { build(); play(); });
  bindSlider("#sSpeed", "#vSpeed", "speed", (v) => v + " c/s", () => {});
  bindSlider("#sDensity", "#vDensity", "density", (v) => v.toFixed(2), () => { if (wfc) wfc.setWeights(weightsFor()); build(); play(); });
  bindSlider("#sComplex", "#vComplex", "complexity", (v) => v.toFixed(2), () => { if (wfc) wfc.setWeights(weightsFor()); build(); play(); });

  function bindToggle(id, key, onChange) {
    const el = $(id);
    if (state[key]) el.classList.add("on");
    el.addEventListener("click", () => {
      state[key] = !state[key];
      el.classList.toggle("on", state[key]);
      onChange(state[key]);
      save();
    });
  }
  bindToggle("#swHeat", "heat", (v) => { renderer.heat = v; lastActivity = performance.now(); });
  bindToggle("#swScan", "scan", (v) => document.body.classList.toggle("no-scan", !v));
  bindToggle("#swLoop", "loop", () => {});
  renderer.heat = state.heat;
  document.body.classList.toggle("no-scan", !state.scan);

  // ---- palette editor -------------------------------------------
  const PRESETS = [
    ["#5ef0e0"],
    ["#22d3e8", "#4f73ff"],
    ["#ff3ea5", "#9b5cff", "#34e6ff", "#ffce4d"],
    ["#ffb347"],
    ["#ff4db8", "#a6ff4d"],
    ["#aee9ff", "#5b8cff", "#c9b8ff"],
    ["#e8e8e8", "#8a8a8a"],
    ["#39f0a0", "#1d8f5f"],
  ];

  function applyPalette() {
    THEMES[state.theme].palette = palettes[state.theme].slice();
    lastActivity = performance.now();
    renderTilesGrid();
  }

  function renderSwatches() {
    const wrap = $("#palette");
    const pal = palettes[state.theme];
    wrap.innerHTML = "";
    pal.forEach((c, i) => {
      const sw = document.createElement("label");
      sw.className = "swatch";
      sw.style.background = c;
      sw.style.boxShadow = "0 0 14px " + c + "88";
      const inp = document.createElement("input");
      inp.type = "color"; inp.value = c;
      inp.addEventListener("input", () => {
        pal[i] = inp.value;
        sw.style.background = inp.value;
        sw.style.boxShadow = "0 0 14px " + inp.value + "88";
        applyPalette(); save();
      });
      sw.appendChild(inp);
      wrap.appendChild(sw);
    });
  }

  function renderPresets() {
    const row = $("#presets");
    row.innerHTML = "";
    PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.className = "preset";
      b.style.width = p.length * 16 + "px";
      p.forEach((c) => { const i = document.createElement("i"); i.style.background = c; b.appendChild(i); });
      b.addEventListener("click", () => {
        palettes[state.theme] = p.slice();
        applyPalette(); renderSwatches(); save();
      });
      row.appendChild(b);
    });
  }

  // ---- theme switch ---------------------------------------------
  function setTheme(t) {
    state.theme = t;
    document.documentElement.dataset.theme = t;
    document.querySelectorAll("#themeSwitch button").forEach((b) =>
      b.classList.toggle("active", b.dataset.themeId === t));
    THEMES[t].palette = palettes[t].slice();
    renderSwatches();
    renderTilesGrid();
    lastActivity = performance.now();
    save();
  }
  document.querySelectorAll("#themeSwitch button").forEach((b) =>
    b.addEventListener("click", () => setTheme(b.dataset.themeId)));

  // ---- learning-section tile grid -------------------------------
  function renderTilesGrid() {
    const grid = $("#tilesGrid");
    if (!grid) return;
    const theme = THEMES[state.theme];
    const pal = theme.palette;
    grid.innerHTML = "";
    PROTO.forEach((p, i) => {
      const cell = document.createElement("div");
      cell.className = "tile-cell";
      const cv = document.createElement("canvas");
      cell.appendChild(cv);
      grid.appendChild(cell);
      const color = pal.length > 1 ? pal[i % pal.length] : pal[0];
      requestAnimationFrame(() => Renderer.drawTileMini(cv, p.e, color, pal.length > 1 ? color : theme.node));
    });
  }

  // ---- dock buttons ---------------------------------------------
  $("#btnGenerate").addEventListener("click", generate);
  $("#btnPlay").addEventListener("click", togglePlay);
  $("#btnStep").addEventListener("click", stepOnce);

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); stepOnce(); }
    else if (e.key.toLowerCase() === "g") { generate(); }
  });

  // ---- scroll reveal --------------------------------------------
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.15 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  // ---- resize ---------------------------------------------------
  window.addEventListener("resize", () => {
    clearTimeout(rT);
    rT = setTimeout(() => {
      const wasPlaying = playing;
      fit();
      build();
      if (wasPlaying || !wfc.done) play();
    }, 160);
  });

  // ---- persistence ----------------------------------------------
  function save() {
    try {
      localStorage.setItem("wfc-settings", JSON.stringify({
        theme: state.theme, grid: state.grid, speed: state.speed,
        density: state.density, complexity: state.complexity,
        heat: state.heat, scan: state.scan, loop: state.loop, palettes,
      }));
    } catch (e) {}
  }
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem("wfc-settings")) || {}; }
    catch (e) { return {}; }
  }

  // ---- boot -----------------------------------------------------
  function boot() {
    fit();
    setTheme(state.theme);
    renderPresets();
    renderSwatches();
    renderTilesGrid();
    build();
    play();
    requestAnimationFrame(frame);
    // auto-land after the opening collapse has had a moment to play
    setTimeout(land, 2200);
    ["wheel", "touchstart", "pointerdown", "keydown"].forEach((ev) =>
      window.addEventListener(ev, () => land(), { once: true, passive: true }));
  }
  boot();

  // debug hook: force a synchronous full collapse + draw (for screenshots)
  window.__wfc = {
    setTheme,
    forceCollapse() {
      build();
      let guard = 0;
      while (!wfc.done && !wfc.contradiction && guard++ < 20000) wfc.step(performance.now());
      if (wfc.contradiction) { build(); }
      land();
      renderer.draw(wfc, state.theme, performance.now());
    },
    land,
  };
})();
