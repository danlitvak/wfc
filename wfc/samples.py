"""A few hardcoded sample images to drive the engine before there's a UI.

Each sample is a 2D numpy array of colour indices plus a matching palette
(index -> RGB). Kept small and structured so the WFC output is easy to eyeball.
"""

from __future__ import annotations

import numpy as np

# index -> RGB
PALETTE = np.array([
    [20, 20, 30],     # 0 dark (background)
    [230, 230, 240],  # 1 light
    [200, 70, 70],    # 2 red
    [70, 140, 200],   # 3 blue
], dtype=float)

# Two-colour checkerboard: the simplest non-trivial overlapping case.
CHECKER = np.array([
    [0, 1],
    [1, 0],
], dtype=int)

# A small "rooms / corridors" sample: light walls on a dark ground. Produces
# the classic blocky maze-ish WFC output.
MAZE = np.array([
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0, 1, 1, 0],
    [0, 1, 0, 1, 0, 0, 1, 0],
    [0, 1, 0, 1, 1, 1, 1, 0],
    [0, 1, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
], dtype=int)

SAMPLES = {
    "checker": CHECKER,
    "maze": MAZE,
}
