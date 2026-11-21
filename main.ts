// Push-optimal Sokoban solver for make.fun's sokoban-solver-01-run-20261121.
//
// Strategy: a generated level is a hallway with one to four rooms off it, each
// room holding 3 or 4 boxes and as many goals, and a box pushed out of its room
// can never come back — so the level's push-optimal count P* is the sum of the
// rooms' optima, and each room can be solved on its own. This program splits
// the level into its rooms, solves every room push-optimally with A* over
// pushes (Hungarian assignment heuristic on box-to-goal distances, dead-square
// pruning, 2x2 freeze detection), and stitches the rooms' move strings
// together with walks along the hallway.
//
// Deterministic by construction: fixed neighbour order everywhere, work budgets
// counted in expansions (never the wall clock), no randomness, no environment
// reads. Two runs write identical bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Work budgets, counted in state expansions — never the clock.
const ROOM_EXPANSION_CAP = 600_000;
const TOTAL_EXPANSION_CAP = 4_000_000;

const DIRS = [
  { dx: 0, dy: -1, ch: 'u' },
  { dx: 0, dy: 1, ch: 'd' },
  { dx: -1, dy: 0, ch: 'l' },
  { dx: 1, dy: 0, ch: 'r' },
];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] as string;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

// Shortest walk from `from` to `to` over walkable cells, avoiding `blocked`
// cells (boxes). Fixed neighbour order, so the path is deterministic.
// Returns null when unreachable.
function walkPath(
  from: number,
  to: number,
  walkable: Uint8Array,
  blocked: Uint8Array,
  w: number,
): string | null {
  if (from === to) return '';
  const n = walkable.length;
  const prev = new Int32Array(n).fill(-1);
  const prevCh = new Array<string>(n).fill('');
  const q: number[] = [from];
  prev[from] = from;
  for (let head = 0; head < q.length; head++) {
    const c = q[head] as number;
    for (const dir of DIRS) {
      const x = c % w;
      if (dir.dx === -1 && x === 0) continue;
      if (dir.dx === 1 && x === w - 1) continue;
      const m = c + dir.dy * w + dir.dx;
      if (m < 0 || m >= n) continue;
      if (!walkable[m] || blocked[m] || prev[m] !== -1) continue;
      prev[m] = c;
      prevCh[m] = dir.ch;
      if (m === to) {
        let s = '';
        for (let t = m; t !== from; t = prev[t] as number) s = prevCh[t] as string + s;
        return s;
      }
      q.push(m);
    }
  }
  return null;
}

// BFS distances from `from` over walkable cells; -1 where unreachable.
function bfsDist(from: number, walkable: Uint8Array, w: number): Int32Array {
  const n = walkable.length;
  const dist = new Int32Array(n).fill(-1);
  const q: number[] = [from];
  dist[from] = 0;
  for (let head = 0; head < q.length; head++) {
    const c = q[head] as number;
    const d = dist[c] as number;
    for (const dir of DIRS) {
      const x = c % w;
      if (dir.dx === -1 && x === 0) continue;
      if (dir.dx === 1 && x === w - 1) continue;
      const m = c + dir.dy * w + dir.dx;
      if (m < 0 || m >= n) continue;
      if (!walkable[m] || dist[m] !== -1) continue;
      dist[m] = d + 1;
      q.push(m);
    }
  }
  return dist;
}

interface RoomSolution {
  moves: string;
  pushes: number;
}

// Solve one room push-optimally. `cells` are the room's floor cells, `entry`
// the hallway cell outside its door (the player's starting cell); boxes never
// leave `cells`. Returns the moves from `entry`, ending with the player back
// at `entry`, or null when the budget runs out.
function solveRoom(
  cells: number[],
  goals: number[],
  boxes0: number[],
  entry: number,
  wall: Uint8Array,
  w: number,
  h: number,
  budget: { remaining: number },
): RoomSolution | null {
  const n = w * h;
  const cellSet = new Uint8Array(n);
  for (const c of cells) cellSet[c] = 1;
  const walkable = new Uint8Array(n);
  for (const c of cells) walkable[c] = 1;
  walkable[entry] = 1;

  // All-pairs distances over walkable cells (ignoring boxes), for the heuristic.
  const distFrom = new Map<number, Int32Array>();
  for (const c of cells) distFrom.set(c, bfsDist(c, walkable, w));
  distFrom.set(entry, bfsDist(entry, walkable, w));

  // Dead squares: reverse push-reachability from the goals, ignoring other
  // boxes. A box on a cell no push-path reaches a goal from is lost.
  const goalSet = new Set(goals);
  const live = new Set<number>(goals);
  const liveQ = [...goals];
  for (let head = 0; head < liveQ.length; head++) {
    const y = liveQ[head] as number;
    for (const dir of DIRS) {
      const x = y - (dir.dy * w + dir.dx);
      if (x < 0 || x >= n || !cellSet[x] || live.has(x)) continue;
      const behind = x - (dir.dy * w + dir.dx);
      if (behind < 0 || behind >= n || !walkable[behind]) continue;
      live.add(x);
      liveQ.push(x);
    }
  }

  const nb = boxes0.length;
  const ng = goals.length;
  // Minimum-assignment heuristic over the goal permutations (at most 4 boxes).
  const perms: number[][] = [];
  const buildPerm = (used: boolean[], cur: number[]): void => {
    if (cur.length === ng) {
      perms.push([...cur]);
      return;
    }
    for (let j = 0; j < ng; j++) {
      if (used[j]) continue;
      used[j] = true;
      cur.push(j);
      buildPerm(used, cur);
      cur.pop();
      used[j] = false;
    }
  };
  buildPerm(new Array<boolean>(ng).fill(false), []);
  const heuristic = (bs: number[]): number => {
    let best = Infinity;
    for (const perm of perms) {
      let sum = 0;
      let ok = true;
      for (let i = 0; i < nb; i++) {
        const d = distFrom.get(bs[i] as number)?.[goals[perm[i] as number] as number] as number;
        if (d === undefined || d < 0) {
          ok = false;
          break;
        }
        sum += d;
      }
      if (ok && sum < best) best = sum;
    }
    return best;
  };

  const isFrozen = (bs: number[]): boolean => {
    const boxSet = new Set(bs);
    for (const b of bs) {
      if (goalSet.has(b)) continue;
      const bx = b % w;
      const by = Math.floor(b / w);
      for (const [ox, oy] of [
        [0, 0],
        [-1, 0],
        [0, -1],
        [-1, -1],
      ]) {
        const x0 = bx + ox;
        const y0 = by + oy;
        if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) continue;
        const sq = [
          y0 * w + x0,
          y0 * w + x0 + 1,
          (y0 + 1) * w + x0,
          (y0 + 1) * w + x0 + 1,
        ];
        if (sq.every((c) => wall[c] === 1 || boxSet.has(c))) return true;
      }
    }
    return false;
  };

  const stateKey = (p: number, bs: number[]): string => p + '|' + bs.join(',');

  // A* over pushes. Node fields live in parallel arrays.
  const sp: number[] = [entry];
  const sb: number[][] = [boxes0.slice()];
  const sg: number[] = [0];
  const sparent: number[] = [-1];
  const spushFrom: number[] = [-1];
  const spushDir: number[] = [-1];
  const best = new Map<string, number>();
  best.set(stateKey(entry, boxes0), 0);
  // Heap entries [f, g, node]; smaller f first, then larger g, then smaller node.
  const heap: [number, number, number][] = [];
  const h0 = heuristic(boxes0);
  if (h0 === Infinity) return null;
  const less = (a: [number, number, number], b: [number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: [number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i] as [number, number, number], heap[p] as [number, number, number])) break;
      const t = heap[i] as [number, number, number];
      heap[i] = heap[p] as [number, number, number];
      heap[p] = t;
      i = p;
    }
  };
  const heapPop = (): [number, number, number] => {
    const top = heap[0] as [number, number, number];
    const last = heap.pop() as [number, number, number];
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1] as [number, number, number], heap[c] as [number, number, number])) c++;
        if (!less(heap[c] as [number, number, number], heap[i] as [number, number, number])) break;
        const t = heap[i] as [number, number, number];
        heap[i] = heap[c] as [number, number, number];
        heap[c] = t;
        i = c;
      }
    }
    return top;
  };
  heapPush([h0, 0, 0]);

  let goalNode = -1;
  let expanded = 0;
  while (heap.length > 0) {
    const [, g, s] = heapPop();
    if (best.get(stateKey(sp[s] as number, sb[s] as number[])) !== s) continue;
    const bs = sb[s] as number[];
    if (bs.every((b) => goalSet.has(b))) {
      goalNode = s;
      break;
    }
    if (expanded >= ROOM_EXPANSION_CAP || budget.remaining <= 0) return null;
    expanded++;
    budget.remaining--;
    const p = sp[s] as number;
    const blocked = new Uint8Array(n);
    for (const b of bs) blocked[b] = 1;
    for (let bi = 0; bi < nb; bi++) {
      const b = bs[bi] as number;
      for (let di = 0; di < 4; di++) {
        const dir = DIRS[di] as { dx: number; dy: number; ch: string };
        const d = dir.dy * w + dir.dx;
        const target = b + d;
        if (target < 0 || target >= n || !cellSet[target] || blocked[target]) continue;
        const behind = b - d;
        if (behind < 0 || behind >= n || !walkable[behind] || blocked[behind]) continue;
        if (walkPath(p, behind, walkable, blocked, w) === null) continue;
        const nbs = bs.slice();
        nbs[bi] = target;
        nbs.sort((a, b2) => a - b2);
        if (nbs.some((x) => !goalSet.has(x) && !live.has(x))) continue;
        if (isFrozen(nbs)) continue;
        const hh = heuristic(nbs);
        if (hh === Infinity) continue;
        const k = stateKey(b, nbs);
        const seenIdx = best.get(k);
        if (seenIdx !== undefined && (sg[seenIdx] as number) <= g + 1) continue;
        const t = sp.length;
        sp.push(b);
        sb.push(nbs);
        sg.push(g + 1);
        sparent.push(s);
        spushFrom.push(b);
        spushDir.push(di);
        best.set(k, t);
        heapPush([g + 1 + hh, g + 1, t]);
      }
    }
  }
  if (goalNode < 0) return null;

  // Reconstruct the push list, then replay it into a move string.
  const pushes: { from: number; dir: number }[] = [];
  for (let t = goalNode; t > 0; t = sparent[t] as number) {
    pushes.push({ from: spushFrom[t] as number, dir: spushDir[t] as number });
  }
  pushes.reverse();
  let moves = '';
  let player = entry;
  const curBoxes = boxes0.slice();
  for (const push of pushes) {
    const dir = DIRS[push.dir] as { dx: number; dy: number; ch: string };
    const d = dir.dy * w + dir.dx;
    const behind = push.from - d;
    const blocked = new Uint8Array(n);
    for (const b of curBoxes) blocked[b] = 1;
    const walk = walkPath(player, behind, walkable, blocked, w);
    if (walk === null) return null;
    moves += walk + dir.ch;
    player = push.from;
    const at = curBoxes.indexOf(push.from);
    curBoxes[at] = push.from + d;
    curBoxes.sort((a, b) => a - b);
  }
  // Walk back out to the hallway.
  const blocked = new Uint8Array(n);
  for (const b of curBoxes) blocked[b] = 1;
  const exit = walkPath(player, entry, walkable, blocked, w);
  if (exit === null) return null;
  moves += exit;
  return { moves, pushes: pushes.length };
}

interface Room {
  cells: number[];
  door: number;
  entry: number;
}

function solveLevel(text: string): string {
  const lv = parseLevel(text);
  const hallRow = Math.floor(lv.player / lv.w);
  const hallWalkable = new Uint8Array(lv.w * lv.h);
  for (let x = 0; x < lv.w; x++) {
    const c = hallRow * lv.w + x;
    if (!lv.wall[c]) hallWalkable[c] = 1;
  }
  const noBlocked = new Uint8Array(lv.w * lv.h);

  // Rooms: connected floor components once the hallway row is removed.
  const seen = new Uint8Array(lv.w * lv.h);
  const rooms: Room[] = [];
  for (let c = 0; c < lv.w * lv.h; c++) {
    if (lv.wall[c] || Math.floor(c / lv.w) === hallRow || seen[c]) continue;
    const cells: number[] = [];
    const q: number[] = [c];
    seen[c] = 1;
    for (let head = 0; head < q.length; head++) {
      const cur = q[head] as number;
      cells.push(cur);
      for (const dir of DIRS) {
        const x = cur % lv.w;
        if (dir.dx === -1 && x === 0) continue;
        if (dir.dx === 1 && x === lv.w - 1) continue;
        const m = cur + dir.dy * lv.w + dir.dx;
        if (m < 0 || m >= lv.w * lv.h) continue;
        if (lv.wall[m] || Math.floor(m / lv.w) === hallRow || seen[m]) continue;
        seen[m] = 1;
        q.push(m);
      }
    }
    let door = -1;
    let entry = -1;
    for (const cell of cells) {
      for (const dir of DIRS) {
        const m = cell + dir.dy * lv.w + dir.dx;
        if (m >= 0 && m < lv.w * lv.h && hallWalkable[m]) {
          door = cell;
          entry = m;
          break;
        }
      }
      if (door !== -1) break;
    }
    if (door === -1) continue;
    rooms.push({ cells, door, entry });
  }
  rooms.sort((a, b) => a.entry - b.entry || a.door - b.door);

  const budget = { remaining: TOTAL_EXPANSION_CAP };
  let moves = '';
  let player = lv.player;
  for (const room of rooms) {
    const roomBoxes = lv.boxes.filter((b) => room.cells.includes(b));
    const roomGoals = lv.goals.filter((g) => room.cells.includes(g));
    if (roomBoxes.length === 0) continue;
    if (roomBoxes.length !== roomGoals.length) return '';
    const hallWalk = walkPath(player, room.entry, hallWalkable, noBlocked, lv.w);
    if (hallWalk === null) return '';
    moves += hallWalk;
    player = room.entry;
    const sol = solveRoom(room.cells, roomGoals, roomBoxes, room.entry, lv.wall, lv.w, lv.h, budget);
    if (sol === null) return '';
    moves += sol.moves;
    player = room.entry;
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
