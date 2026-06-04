import numpy as np

from wfc import extract_patterns, build_adjacency, WFCSolver
from wfc.render import render_indices


def _checker_engine():
    sample = np.array([[0, 1], [1, 0]])
    patterns, weights = extract_patterns(sample, N=2, periodic_input=True)
    compatible = build_adjacency(patterns)
    return patterns, weights, compatible


def test_checker_solves_to_valid_checkerboard():
    patterns, weights, compatible = _checker_engine()
    solver = WFCSolver(patterns, weights, compatible, (8, 8), seed=0)
    solver.run()

    assert solver.done
    assert solver.is_fully_collapsed()

    out = render_indices(solver.wave, patterns)
    # Output uses only colours from the sample.
    assert set(np.unique(out)).issubset({0, 1})
    # Adjacent cells must differ — the defining property of a checkerboard.
    assert (out[:, :-1] != out[:, 1:]).all()
    assert (out[:-1, :] != out[1:, :]).all()


def test_run_is_deterministic_with_seed():
    patterns, weights, compatible = _checker_engine()
    a = WFCSolver(patterns, weights, compatible, (6, 6), seed=42)
    a.run()
    b = WFCSolver(patterns, weights, compatible, (6, 6), seed=42)
    b.run()
    assert np.array_equal(a.wave, b.wave)


def test_step_returns_none_when_done():
    patterns, weights, compatible = _checker_engine()
    solver = WFCSolver(patterns, weights, compatible, (4, 4), seed=1)
    solver.run()
    assert solver.step() is None
