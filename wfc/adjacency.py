"""Adjacency rules for overlapping WFC.

Two patterns are compatible in a given direction if, when you slide one of them
one cell over the other, the region where their N×N footprints overlap agrees on
every pixel. We precompute this once per sample so the solver's propagation step
becomes a fast table lookup instead of a per-step image comparison.
"""

from __future__ import annotations

import numpy as np

# (dr, dc) offsets for the four cardinal neighbours, in a fixed order.
DIRECTIONS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
DIR_NAMES = ["up", "down", "left", "right"]


def agrees(p1, p2, dr, dc) -> bool:
    """True if pattern ``p2`` placed at offset (dr, dc) from ``p1`` overlaps cleanly.

    ``p1`` sits at the origin covering rows/cols [0, N). ``p2`` is shifted by
    (dr, dc). We compare the two over their overlapping cells only.
    """
    N = p1.shape[0]
    r0, r1 = max(0, dr), min(N, N + dr)
    c0, c1 = max(0, dc), min(N, N + dc)
    a = p1[r0:r1, c0:c1]
    b = p2[r0 - dr:r1 - dr, c0 - dc:c1 - dc]
    return np.array_equal(a, b)


def build_adjacency(patterns):
    """Precompute the pattern-to-pattern compatibility table.

    Returns:
        compatible: bool array of shape (4, T, T) where ``compatible[d, t1, t2]``
            is True iff pattern ``t2`` may sit in direction ``DIRECTIONS[d]``
            from pattern ``t1``.
    """
    T = len(patterns)
    compatible = np.zeros((len(DIRECTIONS), T, T), dtype=bool)
    for d, (dr, dc) in enumerate(DIRECTIONS):
        for t1 in range(T):
            for t2 in range(T):
                compatible[d, t1, t2] = agrees(patterns[t1], patterns[t2], dr, dc)
    return compatible
