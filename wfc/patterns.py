"""Pattern extraction for overlapping Wave Function Collapse.

The overlapping model learns its rules straight from a sample image. Step one is
to slide an N×N window over that sample and collect every unique pattern it sees,
together with how often each one occurs (its weight). Those weights later bias
the random collapse so that common patterns appear more often in the output.
"""

from __future__ import annotations

import numpy as np


def _transforms(pattern: np.ndarray, symmetry: int) -> list[np.ndarray]:
    """Return up to ``symmetry`` variants of an N×N pattern under the D4 group.

    Variants are generated in the conventional WFC order — alternating reflect
    and rotate — so that:
        symmetry=1 -> identity only
        symmetry=2 -> + horizontal mirror
        symmetry=4 -> + 180° / 270° rotations
        symmetry=8 -> the full set of rotations and reflections
    """
    v = [None] * 8
    v[0] = pattern
    v[1] = np.fliplr(v[0])
    v[2] = np.rot90(v[0])
    v[3] = np.fliplr(v[2])
    v[4] = np.rot90(v[2])
    v[5] = np.fliplr(v[4])
    v[6] = np.rot90(v[4])
    v[7] = np.fliplr(v[6])
    return v[:symmetry]


def extract_patterns(sample, N=3, periodic_input=True, symmetry=1):
    """Extract the unique N×N patterns and their weights from a 2D sample.

    Args:
        sample: 2D array-like of small integers (palette / colour indices).
        N: pattern (window) size.
        periodic_input: if True the window wraps around the sample edges, so a
            pattern is collected at every position (the classic WFC behaviour).
            If False, only windows fully inside the sample are used.
        symmetry: 1..8 — how many rotations/reflections of each window to add.

    Returns:
        patterns: int array of shape (T, N, N) — the T unique patterns.
        weights:  float array of shape (T,) — occurrence counts.
    """
    sample = np.asarray(sample)
    H, W = sample.shape

    counts: dict[bytes, int] = {}
    order: list[bytes] = []
    by_key: dict[bytes, np.ndarray] = {}

    max_r = H if periodic_input else H - N + 1
    max_c = W if periodic_input else W - N + 1
    if max_r <= 0 or max_c <= 0:
        raise ValueError(f"sample {sample.shape} is smaller than window N={N}")

    for r in range(max_r):
        for c in range(max_c):
            if periodic_input:
                rows = [(r + i) % H for i in range(N)]
                cols = [(c + j) % W for j in range(N)]
                window = sample[np.ix_(rows, cols)]
            else:
                window = sample[r:r + N, c:c + N]

            for variant in _transforms(window, symmetry):
                # tobytes() gives a canonical key for an array's contents, so
                # identical patterns map to the same bucket.
                key = np.ascontiguousarray(variant).tobytes()
                if key not in counts:
                    counts[key] = 0
                    order.append(key)
                    by_key[key] = np.ascontiguousarray(variant).copy()
                counts[key] += 1

    patterns = np.array([by_key[k] for k in order])
    weights = np.array([counts[k] for k in order], dtype=float)
    return patterns, weights
