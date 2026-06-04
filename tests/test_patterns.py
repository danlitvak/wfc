import numpy as np

from wfc.patterns import extract_patterns


def test_checker_has_two_patterns():
    sample = np.array([[0, 1], [1, 0]])
    patterns, weights = extract_patterns(sample, N=2, periodic_input=True)
    # A 2x2 checkerboard yields exactly two distinct 2x2 windows under wrap.
    assert len(patterns) == 2
    assert patterns.shape == (2, 2, 2)
    assert weights.tolist() == [2.0, 2.0]


def test_non_periodic_window_count():
    sample = np.arange(9).reshape(3, 3)  # all-distinct -> every window unique
    patterns, _ = extract_patterns(sample, N=2, periodic_input=False)
    # 2x2 windows fully inside a 3x3 image: 2 * 2 = 4.
    assert len(patterns) == 4


def test_symmetry_expands_pattern_set():
    sample = np.array([[0, 1], [0, 1]])  # vertical stripe, not symmetric
    base, _ = extract_patterns(sample, N=2, periodic_input=True, symmetry=1)
    sym, _ = extract_patterns(sample, N=2, periodic_input=True, symmetry=4)
    assert len(sym) >= len(base)


def test_window_smaller_than_n_raises():
    sample = np.zeros((2, 2), dtype=int)
    try:
        extract_patterns(sample, N=3, periodic_input=False)
    except ValueError:
        return
    raise AssertionError("expected ValueError for N larger than sample")
