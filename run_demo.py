"""Terminal demo of the WFC engine (Milestone 1 — no UI yet).

Usage:
    python run_demo.py [sample] [--n N] [--size H W] [--seed S] [--symmetry K]

Example:
    python run_demo.py maze --n 3 --size 20 40 --seed 7
"""

from __future__ import annotations

import argparse

import numpy as np

from wfc import extract_patterns, build_adjacency, WFCSolver, Contradiction
from wfc.render import render_indices
from wfc.samples import SAMPLES, PALETTE

# 256-colour ANSI blocks so the terminal output roughly matches the palette.
_ANSI = {0: 235, 1: 253, 2: 167, 3: 75}


def show(indices: np.ndarray) -> None:
    for row in indices:
        line = "".join(f"\033[48;5;{_ANSI.get(int(v), 0)}m  \033[0m" for v in row)
        print(line)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sample", nargs="?", default="maze", choices=list(SAMPLES))
    ap.add_argument("--n", type=int, default=3, help="pattern size N")
    ap.add_argument("--size", type=int, nargs=2, default=(16, 32),
                    metavar=("H", "W"), help="output grid size")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--symmetry", type=int, default=1)
    ap.add_argument("--attempts", type=int, default=20,
                    help="restarts allowed on contradiction")
    args = ap.parse_args()

    sample = SAMPLES[args.sample]
    patterns, weights = extract_patterns(
        sample, N=args.n, periodic_input=True, symmetry=args.symmetry)
    compatible = build_adjacency(patterns)
    print(f"sample={args.sample}  N={args.n}  patterns={len(patterns)}  "
          f"output={tuple(args.size)}")

    seed = args.seed
    for attempt in range(args.attempts):
        solver = WFCSolver(patterns, weights, compatible, tuple(args.size),
                           seed=None if seed is None else seed + attempt)
        try:
            steps = solver.run()
        except Contradiction:
            continue
        print(f"solved in {steps} observations (attempt {attempt + 1})\n")
        show(render_indices(solver.wave, patterns))
        return

    print("gave up after contradictions — try a larger N or different seed")


if __name__ == "__main__":
    main()
