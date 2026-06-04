/* ------------------------------------------------------------------
   wfc.js — a real (simplified) Wave Function Collapse engine.
   "Simple tiled model" using the classic pipes / knots tileset.
   Each tile has 4 edge sockets [N,E,S,W], 1 = a line connects to that
   edge, 0 = nothing. Two tiles may sit next to each other only if the
   sockets they share match (1<->1 or 0<->0).
------------------------------------------------------------------- */
(function (global) {
  "use strict";

  // Tile prototypes. `e` = edges [N,E,S,W]. `w` = weight class (for rendering + weighting).
  const PROTO = [
    { id: "empty",  e: [0, 0, 0, 0], w: "empty" },
    { id: "endN",   e: [1, 0, 0, 0], w: "end" },
    { id: "endE",   e: [0, 1, 0, 0], w: "end" },
    { id: "endS",   e: [0, 0, 1, 0], w: "end" },
    { id: "endW",   e: [0, 0, 0, 1], w: "end" },
    { id: "lineV",  e: [1, 0, 1, 0], w: "line" },
    { id: "lineH",  e: [0, 1, 0, 1], w: "line" },
    { id: "elNE",   e: [1, 1, 0, 0], w: "elbow" },
    { id: "elES",   e: [0, 1, 1, 0], w: "elbow" },
    { id: "elSW",   e: [0, 0, 1, 1], w: "elbow" },
    { id: "elWN",   e: [1, 0, 0, 1], w: "elbow" },
    { id: "teeNES", e: [1, 1, 1, 0], w: "tee" },
    { id: "teeESW", e: [0, 1, 1, 1], w: "tee" },
    { id: "teeSWN", e: [1, 0, 1, 1], w: "tee" },
    { id: "teeWNE", e: [1, 1, 0, 1], w: "tee" },
    { id: "cross",  e: [1, 1, 1, 1], w: "cross" },
  ];

  const TILES = PROTO.length; // 16  -> fits in a 32-bit possibility bitmask
  const FULL = (1 << TILES) - 1;

  // dir: 0=N 1=E 2=S 3=W
  const OPP = [2, 3, 0, 1];
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];

  // compat[tile][dir] = bitmask of tiles allowed as the neighbor in `dir`.
  const COMPAT = (function () {
    const c = [];
    for (let a = 0; a < TILES; a++) {
      c[a] = [0, 0, 0, 0];
      for (let d = 0; d < 4; d++) {
        let mask = 0;
        for (let b = 0; b < TILES; b++) {
          if (PROTO[a].e[d] === PROTO[b].e[OPP[d]]) mask |= 1 << b;
        }
        c[a][d] = mask;
      }
    }
    return c;
  })();

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function popcount(x) {
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    x = (x + (x >> 4)) & 0x0f0f0f0f;
    return (x * 0x01010101) >> 24;
  }
  const bitIndex = (t) => 31 - Math.clz32(t);

  class WFC {
    constructor(cols, rows, opts) {
      opts = opts || {};
      this.cols = cols;
      this.rows = rows;
      this.setWeights(opts.weights);
      this.seedValue = opts.seed == null ? (Math.random() * 4294967296) >>> 0 : opts.seed >>> 0;
      this.reset();
    }

    setWeights(wmap) {
      const def = { empty: 16, end: 0.5, line: 6, elbow: 5, tee: 2, cross: 0.8 };
      this.wmap = Object.assign(def, wmap || {});
      this.weights = PROTO.map((p) => this.wmap[p.w]);
    }

    reseed(s) {
      this.seedValue = s == null ? (Math.random() * 4294967296) >>> 0 : s >>> 0;
    }

    reset() {
      const n = this.cols * this.rows;
      this.rng = mulberry32(this.seedValue);
      this.mask = new Int32Array(n).fill(FULL);
      this.collapsed = new Uint8Array(n);
      this.changed = new Float64Array(n); // last-change timestamp (for glow)
      this.done = false;
      this.contradiction = false;
      this.count = 0;
      this.steps = 0;
      this.lastCollapsed = -1;
      this.rippleCells = [];
    }

    entropy(i) { return popcount(this.mask[i]); }

    // lowest-entropy uncollapsed cell, with small random tie-break noise
    findCell() {
      let best = -1, bestKey = Infinity;
      const m = this.mask, col = this.collapsed;
      for (let i = 0; i < m.length; i++) {
        if (col[i]) continue;
        const e = popcount(m[i]);
        if (e === 0) { this.contradiction = true; return -1; }
        if (e === 1) { col[i] = 1; this.count++; continue; }
        const key = e + this.rng() * 0.7;
        if (key < bestKey) { bestKey = key; best = i; }
      }
      return best;
    }

    collapse(i, now) {
      let m = this.mask[i], total = 0;
      const opts = [];
      for (let t = 0; t < TILES; t++) {
        if (m & (1 << t)) { opts.push(t); total += this.weights[t]; }
      }
      let r = this.rng() * total, pick = opts[0];
      for (const t of opts) { r -= this.weights[t]; if (r <= 0) { pick = t; break; } }
      this.mask[i] = 1 << pick;
      this.collapsed[i] = 1;
      this.count++;
      this.lastCollapsed = i;
      this.changed[i] = now;
      this.propagate(i, now);
    }

    propagate(start, now) {
      const stack = [start];
      const ripple = [];
      while (stack.length) {
        const c = stack.pop();
        const cx = c % this.cols, cy = (c / this.cols) | 0;
        const cm = this.mask[c];
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX[d], ny = cy + DY[d];
          if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
          const ni = ny * this.cols + nx;
          // union of allowed neighbor tiles given current cell possibilities
          let allowed = 0, tm = cm;
          while (tm) { const low = tm & -tm; allowed |= COMPAT[bitIndex(low)][d]; tm ^= low; }
          const nm = this.mask[ni];
          const newm = nm & allowed;
          if (newm !== nm) {
            if (newm === 0) { this.contradiction = true; return; }
            this.mask[ni] = newm;
            this.changed[ni] = now;
            ripple.push(ni);
            if (popcount(newm) === 1 && !this.collapsed[ni]) { this.collapsed[ni] = 1; this.count++; }
            stack.push(ni);
          }
        }
      }
      this.rippleCells = ripple;
    }

    // One observation + full propagation. Returns 'progress' | 'done' | 'contradiction'.
    step(now) {
      if (this.done) return "done";
      if (this.contradiction) return "contradiction";
      const i = this.findCell();
      if (this.contradiction) return "contradiction";
      if (i === -1) { this.done = true; return "done"; }
      this.collapse(i, now);
      this.steps++;
      if (this.contradiction) return "contradiction";
      if (this.count >= this.mask.length) this.done = true;
      return this.done ? "done" : "progress";
    }

    tileEdges(i) {
      if (!this.collapsed[i]) return null;
      return PROTO[bitIndex(this.mask[i])].e;
    }
  }

  global.WFC = WFC;
  global.WFC_PROTO = PROTO;
  global.WFC_TILES = TILES;
})(window);
