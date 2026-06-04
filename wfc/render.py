"""Turn the current wave state into something you can look at.

For a fully-collapsed cell we take the colour from the top-left pixel of its one
remaining pattern. For a still-undecided cell we average over all its possible
patterns, which gives WFC's characteristic "blurry until it resolves" look —
handy when we animate the solve later.
"""

from __future__ import annotations

import numpy as np


def render_indices(wave, patterns):
    """Return an (H, W) array of colour indices.

    Undecided cells fall back to their first still-possible pattern; empty
    (contradictory) cells fall back to 0.
    """
    H, W, T = wave.shape
    tl = patterns[:, 0, 0]  # top-left colour index of each pattern
    out = np.zeros((H, W), dtype=patterns.dtype)
    for r in range(H):
        for c in range(W):
            possible = np.flatnonzero(wave[r, c])
            out[r, c] = tl[possible[0]] if possible.size else 0
    return out


def render_rgb(wave, patterns, palette):
    """Return an (H, W, 3) float image by averaging palette colours.

    Args:
        palette: (num_colours, 3) array mapping colour index -> RGB.

    Undecided cells become the mean RGB of their possible patterns' colours.
    """
    palette = np.asarray(palette, dtype=float)
    tl_rgb = palette[patterns[:, 0, 0]]                    # (T, 3) RGB per pattern
    counts = wave.sum(axis=2)                              # (H, W) possibilities
    # Sum the colours of every still-possible pattern per cell, then average.
    summed = np.tensordot(wave, tl_rgb, axes=([2], [0]))   # (H, W, 3)
    safe = np.where(counts == 0, 1, counts)[..., None]     # avoid /0 on empty cells
    out = summed / safe
    out[counts == 0] = 0
    return out
