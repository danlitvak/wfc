import numpy as np

from wfc.render import render_indices, render_rgb


PATTERNS = np.array([
    [[0, 0], [0, 0]],   # pattern 0 -> colour index 0
    [[1, 0], [0, 0]],   # pattern 1 -> colour index 1
    [[2, 0], [0, 0]],   # pattern 2 -> colour index 2
])
PALETTE = np.array([
    [0, 0, 0],
    [100, 0, 0],
    [0, 200, 0],
], dtype=float)


def _render_rgb_reference(wave, patterns, palette):
    """Slow, obviously-correct version used to pin the vectorized one."""
    tl_rgb = np.asarray(palette, float)[patterns[:, 0, 0]]
    H, W, T = wave.shape
    out = np.zeros((H, W, 3))
    for r in range(H):
        for c in range(W):
            possible = wave[r, c]
            if possible.any():
                out[r, c] = tl_rgb[possible].mean(axis=0)
    return out


def test_render_rgb_matches_reference():
    rng = np.random.default_rng(0)
    wave = rng.random((5, 7, 3)) > 0.4  # random possibility masks
    wave[0, 0] = [False, False, False]  # include an empty/contradictory cell
    fast = render_rgb(wave, PATTERNS, PALETTE)
    slow = _render_rgb_reference(wave, PATTERNS, PALETTE)
    assert np.allclose(fast, slow)


def test_render_rgb_collapsed_cell_is_exact_colour():
    wave = np.zeros((1, 1, 3), dtype=bool)
    wave[0, 0, 2] = True  # only pattern 2 possible -> colour index 2 -> green
    out = render_rgb(wave, PATTERNS, PALETTE)
    assert np.allclose(out[0, 0], [0, 200, 0])


def test_render_indices_picks_collapsed_pattern():
    wave = np.zeros((1, 2, 3), dtype=bool)
    wave[0, 0, 1] = True
    wave[0, 1, 2] = True
    out = render_indices(wave, PATTERNS)
    assert out.tolist() == [[1, 2]]
