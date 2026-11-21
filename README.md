# sokoban-solver-01-run-20261121

[![make.fun](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/t65244973-cell/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/t65244973-cell/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver, built for [make.fun's sokoban-solver-01-run-20261121 bounty](https://make.fun/bounty/sokoban-solver-01-run-20261121).

## How it works

A generated level is a hallway with one to four rooms off it. Each room holds
3 or 4 boxes and as many goals, and a box pushed out of its room can never
come back — so the level's push-optimal count P\* is the sum of the rooms'
optima, and each room can be solved on its own.

`main.ts` splits the level into its rooms, solves every room push-optimally
with A\* over pushes (Hungarian assignment heuristic on box-to-goal distances,
dead-square pruning, 2×2 freeze detection), and stitches the rooms' move
strings together with walks along the hallway.

## Practice result

On the kit's practice set it scores **1,000,000** — every instance solved in
exactly P\* pushes (13, 16, 29, 47, 60). The house baseline, plain-astar
1.0.0, scores 200,000 on the same set (only the first instance solved). Two
runs write byte-identical output, and the whole set solves in about 0.6 s,
far inside the 60 s wall budget.

## Run it

```sh
node main.ts
```

It reads `/input/<id>/level.txt` and writes `/output/<id>/solution.txt` for
every instance. For a local run:

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22, standard library only, no dependencies, no network.

My make.fun referral link: https://make.fun/r/s6yd0164
