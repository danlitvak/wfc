/* ------------------------------------------------------------------
   render.js — draws the WFC grid to a canvas with neon glow.
   Collapsed cells draw their pipe tile; uncollapsed cells show a faint
   "superposition" mark whose brightness rises as entropy falls.
   Recently-changed cells flash, so you can see propagation ripple.
------------------------------------------------------------------- */
(function (global) {
  "use strict";

  const TILES = global.WFC_TILES;

  // Each theme defines the canvas palette + glow character.
  const THEMES = {
    phosphor: {
      bg: "#04060a",
      palette: ["#5ef0e0"],
      node: "#c8fff6",
      glow: 16, lineScale: 0.12, nodeScale: 0.15,
      multi: false, scan: true, gridlines: false,
      dimRGB: "94,240,224",
    },
    circuit: {
      bg: "#060a11",
      palette: ["#22d3e8", "#4f73ff"],
      node: "#8ef0ff",
      glow: 13, lineScale: 0.11, nodeScale: 0.15,
      multi: false, scan: false, gridlines: true,
      dimRGB: "79,115,255",
    },
    spectrum: {
      bg: "#07050f",
      palette: ["#ff3ea5", "#9b5cff", "#34e6ff", "#ffce4d"],
      node: "#ffffff",
      glow: 22, lineScale: 0.13, nodeScale: 0.16,
      multi: true, scan: false, gridlines: false,
      dimRGB: "155,92,255",
    },
  };

  const FLASH_MS = 460;
  const HEAT = ["#ff4d4d", "#ff9a3d", "#ffd23d", "#9be84d", "#4de8c0", "#4d9aff"];

  // deterministic per-cell hue index for multi-colour themes
  function hashIdx(i, n) {
    let h = (i * 2654435761) >>> 0;
    h ^= h >>> 13; h = (h * 1597334677) >>> 0;
    return h % n;
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.heat = false;
    }

    // size canvas backing store to its CSS layout size (CSS handles display size)
    resize(cssW, cssH) {
      this.cssW = cssW; this.cssH = cssH;
      this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
      this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
    }

    cellColor(theme, i, edges) {
      const pal = theme.palette;
      if (pal.length > 1) return pal[hashIdx(i, pal.length)];
      return pal[0];
    }

    draw(wfc, themeName, now) {
      const theme = THEMES[themeName];
      const ctx = this.ctx;
      const W = this.canvas.width, H = this.canvas.height;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, this.cssW, this.cssH);

      const cell = Math.min(this.cssW / wfc.cols, this.cssH / wfc.rows);
      const gw = cell * wfc.cols, gh = cell * wfc.rows;
      const ox = (this.cssW - gw) / 2, oy = (this.cssH - gh) / 2;
      ctx.save();
      ctx.translate(ox, oy);

      if (theme.gridlines) {
        ctx.strokeStyle = "rgba(255,255,255,0.035)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= wfc.cols; x++) { ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, gh); }
        for (let y = 0; y <= wfc.rows; y++) { ctx.moveTo(0, y * cell); ctx.lineTo(gw, y * cell); }
        ctx.stroke();
      }

      const lw = Math.max(1.5, cell * theme.lineScale);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // pass 1: uncollapsed superposition marks (cheap, no glow)
      ctx.shadowBlur = 0;
      for (let i = 0; i < wfc.mask.length; i++) {
        if (wfc.collapsed[i]) continue;
        const cx = (i % wfc.cols) * cell + cell / 2;
        const cy = ((i / wfc.cols) | 0) * cell + cell / 2;
        const e = wfc.entropy(i);
        const settle = 1 - (e - 1) / (TILES - 1); // 0 (max options) -> 1 (almost decided)
        const age = now - wfc.changed[i];
        const flash = wfc.changed[i] > 0 ? Math.max(0, 1 - age / FLASH_MS) : 0;
        if (this.heat) {
          const hi = Math.min(HEAT.length - 1, Math.floor((e - 1) / (TILES - 1) * (HEAT.length - 1)));
          ctx.fillStyle = HEAT[HEAT.length - 1 - hi];
          ctx.globalAlpha = 0.5 + 0.4 * settle;
          const r = cell * 0.16;
          ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
        } else {
          const a = 0.06 + 0.28 * settle + 0.5 * flash;
          ctx.fillStyle = "rgba(" + theme.dimRGB + "," + a.toFixed(3) + ")";
          const r = cell * (0.05 + 0.06 * settle) + flash * cell * 0.08;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // pass 2: collapsed tiles with glow
      for (let i = 0; i < wfc.mask.length; i++) {
        if (!wfc.collapsed[i]) continue;
        const edges = wfc.tileEdges(i);
        if (!edges) continue;
        const cx = (i % wfc.cols) * cell + cell / 2;
        const cy = ((i / wfc.cols) | 0) * cell + cell / 2;
        const half = cell / 2;
        const age = now - wfc.changed[i];
        const flash = Math.max(0, 1 - age / FLASH_MS);
        const conns = edges[0] + edges[1] + edges[2] + edges[3];

        const color = this.cellColor(theme, i, edges);
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.shadowColor = color;
        ctx.shadowBlur = theme.glow * (0.7 + flash * 0.9);

        if (conns === 0) {
          // empty tile: faint dot
          ctx.shadowBlur = theme.glow * 0.4;
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.18 + flash * 0.4;
          ctx.beginPath();
          ctx.arc(cx, cy, cell * 0.06, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }

        // lines from centre to each connected edge
        ctx.beginPath();
        if (edges[0]) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - half); }
        if (edges[1]) { ctx.moveTo(cx, cy); ctx.lineTo(cx + half, cy); }
        if (edges[2]) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + half); }
        if (edges[3]) { ctx.moveTo(cx, cy); ctx.lineTo(cx - half, cy); }
        ctx.stroke();

        // centre node
        const nodeColor = theme.palette.length > 1 ? color : theme.node;
        ctx.fillStyle = nodeColor;
        ctx.shadowBlur = theme.glow * (0.6 + flash);
        ctx.beginPath();
        ctx.arc(cx, cy, cell * theme.nodeScale * (conns === 1 ? 0.7 : 1), 0, Math.PI * 2);
        ctx.fill();

        // flash overlay: bright white pulse on the cell that just resolved
        if (flash > 0.01) {
          ctx.strokeStyle = "rgba(255,255,255," + (flash * 0.85).toFixed(3) + ")";
          ctx.lineWidth = lw * 0.6;
          ctx.shadowBlur = theme.glow * 1.4 * flash;
          ctx.shadowColor = "#ffffff";
          ctx.beginPath();
          if (edges[0]) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - half); }
          if (edges[1]) { ctx.moveTo(cx, cy); ctx.lineTo(cx + half, cy); }
          if (edges[2]) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + half); }
          if (edges[3]) { ctx.moveTo(cx, cy); ctx.lineTo(cx - half, cy); }
          ctx.stroke();
        }
        ctx.shadowColor = color;
      }

      ctx.restore();
      ctx.shadowBlur = 0;
    }

    // small static render of a single tile (used in the learning section)
    static drawTileMini(canvas, edges, color, node) {
      const ctx = canvas.getContext("2d");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const s = canvas.clientWidth;
      canvas.width = s * dpr; canvas.height = s * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s, s);
      const c = s / 2, half = s / 2 - s * 0.04;
      const conns = edges[0] + edges[1] + edges[2] + edges[3];
      ctx.lineCap = "round";
      ctx.strokeStyle = color; ctx.lineWidth = s * 0.1;
      ctx.shadowColor = color; ctx.shadowBlur = 10;
      ctx.beginPath();
      if (edges[0]) { ctx.moveTo(c, c); ctx.lineTo(c, c - half); }
      if (edges[1]) { ctx.moveTo(c, c); ctx.lineTo(c + half, c); }
      if (edges[2]) { ctx.moveTo(c, c); ctx.lineTo(c, c + half); }
      if (edges[3]) { ctx.moveTo(c, c); ctx.lineTo(c - half, c); }
      ctx.stroke();
      if (conns > 0) {
        ctx.fillStyle = node; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(c, c, s * 0.11 * (conns === 1 ? 0.7 : 1), 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(c, c, s * 0.05, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  Renderer.THEMES = THEMES;
  global.Renderer = Renderer;
})(window);
