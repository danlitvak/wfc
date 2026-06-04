import numpy as np

from wfc.adjacency import agrees, build_adjacency, DIRECTIONS, DIR_NAMES


P0 = np.array([[0, 1], [1, 0]])
P1 = np.array([[1, 0], [0, 1]])


def test_agrees_right_neighbour():
    # Looking right (0, 1): the checkerboard pattern can only be followed by its
    # opposite, never by itself.
    assert agrees(P0, P1, 0, 1) is True
    assert agrees(P0, P0, 0, 1) is False


def test_self_overlap_zero_offset():
    # Offset (0, 0) means full overlap: a pattern always agrees with itself.
    assert agrees(P0, P0, 0, 0) is True
    assert agrees(P0, P1, 0, 0) is False


def test_build_adjacency_shape_and_values():
    patterns = np.stack([P0, P1])
    compat = build_adjacency(patterns)
    assert compat.shape == (4, 2, 2)
    right = DIR_NAMES.index("right")
    # In every cardinal direction the checkerboard alternates patterns.
    assert compat[right, 0, 1] and not compat[right, 0, 0]
    assert compat[right, 1, 0] and not compat[right, 1, 1]


def test_directions_consistent_length():
    assert len(DIRECTIONS) == len(DIR_NAMES) == 4
