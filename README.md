# Sokoban Solver

[![make.fun bounty](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![make.fun rank](https://make.fun/badge/sokoban-solver-01-run-20261121/ngadukun/sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![make.fun reward](https://make.fun/badge/sokoban-solver-01-run-20261121/ngadukun/sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

Entry for make.fun's
[sokoban-solver-01-run-20261121](https://make.fun/bounty/sokoban-solver-01-run-20261121)
bounty: a Sokoban solver that answers each drawn level with a push-optimal
solution — 1,000 points an instance only at the optimum number of pushes, and
under half for even one push more.

## How it works

Every level the generator draws is a one-square-wide hallway with small rooms
off it, each room holding 3 or 4 boxes and as many goals behind a single door.
A box pushed into the hallway can never reach a goal, so no box ever leaves
its room and a level's push optimum is the sum of its rooms' optima.

`main.ts` therefore:

1. cuts the hallway out of the board — its squares are dead, meaning a box
   there reaches no goal — and takes each remaining part that holds boxes as
   one room;
2. solves each room with a breadth-first search over pushes, where a state is
   the boxes' squares plus the lowest square of the player's reachable region,
   so the first solution found is push-optimal; pushes onto dead squares and
   pushes that freeze a 2×2 block of walls and boxes are pruned;
3. walks the player between rooms along the hallway, which costs no pushes.

Levels that are not a set of rooms fall back to the same push search over the
whole board, then to a move-level A*. All budgets are counts of states, never
the clock, and ties break by square and direction order, so two runs of the
program write byte-identical answers.

## Local run

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=<dir with i001..i005/level.txt> MAKEFUN_OUTPUT_DIR=out node main.ts
```

On the kit's practice set it scores the maximum: every instance solved in
exactly the reference optimum (13, 16, 29, 47 and 60 pushes).
