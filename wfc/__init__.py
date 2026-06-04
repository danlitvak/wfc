"""wfc — an overlapping Wave Function Collapse engine (pure Python + numpy).

This package is plain Python so it runs and tests in a normal terminal with
pytest. The browser build (Pyodide) imports the exact same code.

Pipeline:
    sample image
      -> extract_patterns   (patterns.py)   find unique N×N windows + weights
      -> build_adjacency    (adjacency.py)  which patterns may neighbour which
      -> WFCSolver          (solver.py)     observe / collapse / propagate
      -> render_*           (render.py)     wave state -> pixels
"""

from .patterns import extract_patterns
from .adjacency import build_adjacency, DIRECTIONS, DIR_NAMES, agrees
from .solver import WFCSolver, Contradiction
from .render import render_indices, render_rgb

__all__ = [
    "extract_patterns",
    "build_adjacency",
    "DIRECTIONS",
    "DIR_NAMES",
    "agrees",
    "WFCSolver",
    "Contradiction",
    "render_indices",
    "render_rgb",
]
