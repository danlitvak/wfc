"""The WFC solve loop.

Each output cell starts holding *every* pattern as a possibility (the "wave").
We repeat two steps:

    observe  — pick the least-decided cell and collapse it to a single pattern,
               chosen randomly but weighted by how common that pattern was.
    propagate — ripple that decision outward: a neighbour may only keep patterns
                that are compatible with something still possible in this cell.

This continues until every cell is decided (success) or some cell is left with
no options at all (a contradiction).
"""

from __future__ import annotations

import numpy as np

from .adjacency import DIRECTIONS


class Contradiction(Exception):
    """Raised when propagation empties a cell of all possibilities."""


class WFCSolver:
    def __init__(self, patterns, weights, compatible, out_shape,
                 seed=None, periodic_output=False):
        self.patterns = patterns
        self.weights = np.asarray(weights, dtype=float)
        self.compatible = compatible
        self.T = len(patterns)
        self.H, self.W = out_shape
        self.periodic_output = periodic_output
        self.rng = np.random.default_rng(seed)
        # wave[r, c, t] -> is pattern t still possible at cell (r, c)?
        self.wave = np.ones((self.H, self.W, self.T), dtype=bool)
        self.done = False

    # ---- observation ------------------------------------------------------
    def _find_min_entropy_cell(self):
        """Return the undecided cell with the fewest remaining options, or None.

        Uses a count of possibilities as a cheap entropy proxy, with a touch of
        random noise so ties don't always resolve toward the same corner.
        """
        counts = self.wave.sum(axis=2)
        undecided = counts > 1  # >1 option left; ==1 is decided, ==0 is dead
        if not undecided.any():
            return None
        # Add small noise to break ties, then take the global minimum. Decided
        # cells are pushed to +inf so they're never picked.
        noisy = np.where(undecided, counts + self.rng.random(counts.shape) * 1e-6,
                         np.inf)
        r, c = np.unravel_index(np.argmin(noisy), counts.shape)
        return (int(r), int(c))

    def observe(self):
        """Collapse the lowest-entropy cell. Returns that cell, or None when done."""
        cell = self._find_min_entropy_cell()
        if cell is None:
            self.done = True
            return None
        r, c = cell
        possible = np.flatnonzero(self.wave[r, c])
        w = self.weights[possible]
        chosen = self.rng.choice(possible, p=w / w.sum())
        # Keep only the chosen pattern at this cell.
        self.wave[r, c] = False
        self.wave[r, c, chosen] = True
        return (r, c)

    # ---- propagation ------------------------------------------------------
    def propagate(self, start):
        """Push the consequences of a change at ``start`` out across the grid."""
        stack = [start]
        while stack:
            r, c = stack.pop()
            possible = self.wave[r, c]
            for d, (dr, dc) in enumerate(DIRECTIONS):
                nr, nc = r + dr, c + dc
                if self.periodic_output:
                    nr %= self.H
                    nc %= self.W
                elif not (0 <= nr < self.H and 0 <= nc < self.W):
                    continue
                # Which patterns are allowed at the neighbour? Any pattern that
                # is compatible (in direction d) with at least one pattern still
                # possible in the current cell.
                allowed = self.compatible[d][possible].any(axis=0)
                neighbour = self.wave[nr, nc]
                new = neighbour & allowed
                if not new.any():
                    raise Contradiction(f"cell ({nr},{nc}) has no options left")
                if not np.array_equal(new, neighbour):
                    self.wave[nr, nc] = new
                    stack.append((nr, nc))

    # ---- driver -----------------------------------------------------------
    def step(self):
        """Run one observe + propagate. Returns the collapsed cell, or None when done."""
        if self.done:
            return None
        cell = self.observe()
        if cell is None:
            return None
        self.propagate(cell)
        return cell

    def run(self, max_steps=None):
        """Collapse until solved (or ``max_steps`` reached). Returns steps taken."""
        steps = 0
        while not self.done:
            if max_steps is not None and steps >= max_steps:
                break
            if self.step() is None:
                break
            steps += 1
        return steps

    def is_fully_collapsed(self) -> bool:
        return bool((self.wave.sum(axis=2) == 1).all())
