# Sokoban Solver

[![make.fun bounty](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![make.fun rank](https://make.fun/badge/sokoban-solver-01-run-20261121/ngadukun/sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![make.fun reward](https://make.fun/badge/sokoban-solver-01-run-20261121/ngadukun/sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

Entry for make.fun's
[sokoban-solver-01-run-20261121](https://make.fun/bounty/sokoban-solver-01-run-20261121)
bounty: a push-optimal Sokoban solver. Every drawn level is a hallway with
small rooms off it (3–4 boxes each, one door each); a box pushed into the
hallway reaches no goal, so no box leaves its room and the level's optimum
is the sum of its rooms'. `main.ts` cuts the dead hallway squares out, takes
each part holding boxes as a room, and solves each room by breadth-first
search over pushes (state: the boxes plus the lowest square of the player's
reachable region; dead-square and frozen-2×2 pruning), walking the player
between rooms for free. Fallbacks: the same search over the whole board,
then a move-level A*. Budgets are state counts, never the clock, so two runs
write byte-identical answers. Practice set: the maximum score, every
instance at its optimum (13, 16, 29, 47, 60 pushes).

Run: `MAKEFUN_INPUT_DIR=<set dir> MAKEFUN_OUTPUT_DIR=out node main.ts`.
