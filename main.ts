// Sokoban solver: push-optimal, room by room.
//
// A level from this competition's generator is a one-square-wide hallway with small rooms off it, each
// room holding 3 or 4 boxes and as many goals, joined to the hallway by a single door. A box pushed
// into the hallway can never reach a goal, so no box ever leaves its room and the level's push optimum
// is the sum of its rooms' optima. The solver therefore:
//
//   1. cuts the hallway out of the board (its squares are dead: a box there reaches no goal) and takes
//      each remaining part that holds boxes as one room;
//   2. solves each room on its own with a breadth-first search over pushes — a state is the boxes'
//      squares plus the lowest square of the player's reachable region, so the first solution the
//      search meets is push-optimal — pruning pushes onto dead squares and pushes that freeze a
//      2 x 2 block of walls and boxes with a box off its goal;
//   3. walks the player between rooms along the hallway, which costs no pushes.
//
// If a level is not a set of rooms, or a room's search gives up, the solver falls back to the same
// push search over the whole board, then to a move-level A* that at least solves the level, then to
// an empty answer. Every budget is a count of states, never the clock, and every tie breaks by square
// and direction order, so two runs write the same bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
// The four directions: [dx, dy, walk letter, push letter].
const DIRS = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];
const ROOM_STATES = 900_000;
const BOARD_STATES = 2_000_000;
const ASTAR_STATES = 1_500_000;

// A level in XSB text: width and height, walls (the outer frame always wall), goals, boxes, player.
function parseLevel(text) {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals = [];
  const boxes = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

// The squares from which a box alone can be pushed onto some goal, pulled back from the goals over
// open floor: a box pushed from y along d lands on y + d, with the player standing on y - d.
function liveSquares(w, wall, goals) {
  const live = new Uint8Array(wall.length);
  const queue = [];
  for (const g of goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let head = 0; head < queue.length; head++) {
    const x = queue[head];
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (y >= 0 && y < wall.length && !wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

// Flood the player's reachable region from `from` around walls and the boxes in `occupied`, marking
// `seen` with `stamp`; returns the region's lowest square, the region's name in a search state.
function reach(w, wall, occupied, from, seen, stamp, stack) {
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n];
    if (p < low) low = p;
    const nb = [p - w, p + w, p - 1, p + 1];
    for (let k = 0; k < 4; k++) {
      const q = nb[k];
      if (q >= 0 && q < wall.length && !wall[q] && !occupied[q] && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

// Whether the box just pushed to `t` sits in a 2 x 2 block of only walls and boxes, one box off goal.
function frozenBlock(w, wall, occupied, goal, t) {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (a < 0 || d >= wall.length) continue;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b])) continue;
    if (!(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b])) return true;
    if ((occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

// The shortest walk from `from` to `to` around walls and boxes, in lower LURD letters.
function walkTo(w, wall, occupied, from, to) {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (q < 0 || q >= wall.length || wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) return null;
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}

const encode = (boxes) => String.fromCharCode(...boxes);
const decode = (s) => {
  const out = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
};

// The push-optimal solution of one board (a room, or a whole level as a fallback): breadth-first
// over pushes, so the first solved state met is optimal. {pushes, moves} or null past maxStates.
function solvePushes(board, maxStates) {
  const { w, wall, goals, player } = board;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(w, wall, goals);
  const start = board.boxes.slice().sort((a, b) => a - b);
  if (start.some((b) => !live[b])) return null;
  const solved = (bs) => bs.every((b) => goal[b]);
  if (solved(start)) return { pushes: 0, moves: '' };
  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  // One search state: the boxes as a char-code string, the square the player stands on, its parent.
  const statesBoxes = [encode(start)];
  const statesPlayer = [player];
  const parent = [-1];
  const index = new Set();
  for (const b of start) occupied[b] = 1;
  const startLow = reach(w, wall, occupied, player, seen, ++stamp, stack);
  index.add(statesBoxes[0] + String.fromCharCode(startLow));
  for (const b of start) occupied[b] = 0;
  let found = -1;
  for (let head = 0; head < statesBoxes.length && found < 0; head++) {
    const boxes = decode(statesBoxes[head]);
    for (const b of boxes) occupied[b] = 1;
    reach(w, wall, occupied, statesPlayer[head], seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi];
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        if (t < 0 || t >= size || seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(w, wall, occupied, goal, t);
        let key = null;
        let next = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((a, b2) => a - b2);
          const low = reach(w, wall, occupied, b, mark, ++stamp, stack);
          key = encode(next) + String.fromCharCode(low);
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || index.has(key)) continue;
        if (statesBoxes.length >= maxStates) return null;
        index.add(key);
        statesBoxes.push(encode(next));
        statesPlayer.push(b);
        parent.push(head);
        if (solved(next)) found = statesBoxes.length - 1;
      }
    }
    for (const b of boxes) occupied[b] = 0;
  }
  if (found < 0) return null;
  // Rebuild the moves: for each push on the path, walk to its push square, then push.
  const path = [];
  for (let s = found; s > 0; s = parent[s]) path.push(s);
  path.reverse();
  let moves = '';
  let p = player;
  let boxes = start;
  for (const s of path) {
    const nextBoxes = decode(statesBoxes[s]);
    const from = boxes.find((b) => !nextBoxes.includes(b));
    const to = nextBoxes.find((b) => !boxes.includes(b));
    const d = to - from;
    const dir = DIRS.find(([dx, dy]) => dy * w + dx === d);
    for (const b of boxes) occupied[b] = 1;
    const walk = walkTo(w, wall, occupied, p, from - d);
    for (const b of boxes) occupied[b] = 0;
    if (walk === null) return null;
    moves += walk + dir[3];
    p = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

// The level's rooms: cut the dead squares of the player's row (the hallway) out of the floor; each
// part left that holds a box is a room. Null when the level is no set of rooms.
function roomsOf(level) {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(w, wall, goals);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i] + dy * w + dx;
        if (q >= 0 && q < wall.length && !wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]].boxes.push(b);
  for (const g of goals) if (part[g] >= 0) rooms[part[g]].goals.push(g);
  if (goals.some((g) => part[g] < 0)) return null;
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

// The square the player stands on after `moves` from `player`, and the boxes after them.
function endOf(w, wall, boxes, player, moves) {
  const occupied = new Set(boxes);
  let p = player;
  for (const ch of moves) {
    const low = ch.toLowerCase();
    const dir = DIRS.find(([, , letter]) => letter === low);
    const d = dir[1] * w + dir[0];
    const q = p + d;
    if (occupied.has(q)) {
      occupied.delete(q);
      occupied.add(q + d);
    }
    p = q;
  }
  return { player: p, boxes: [...occupied].sort((a, b) => a - b) };
}

// A move-level A*: solves a level in the fewest steps, not the fewest pushes. The last resort.
function solveMoves(board, maxStates) {
  const { w, wall, goals, player } = board;
  const goal = new Uint8Array(wall.length);
  for (const g of goals) goal[g] = 1;
  const dist = (b) => Math.min(...goals.map((g) => Math.abs((g % w) - (b % w)) + Math.abs(Math.floor(g / w) - Math.floor(b / w))));
  const est = (bs) => bs.reduce((a, b) => a + dist(b), 0);
  const start = board.boxes.slice().sort((a, b) => a - b);
  const sp = [player];
  const sb = [encode(start)];
  const sg = [0];
  const parent = [-1];
  const step = [''];
  const best = new Map([[player + '|' + sb[0], 0]]);
  const heap = [[est(start), 0, 0]];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[2] < b[2]);
  const pushHeap = (e) => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const popHeap = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1], heap[c])) c++;
        if (!less(heap[c], heap[i])) break;
        [heap[i], heap[c]] = [heap[c], heap[i]];
        i = c;
      }
    }
    return top;
  };
  let expanded = 0;
  while (heap.length > 0 && expanded < maxStates) {
    const [, g, s] = popHeap();
    const boxes = decode(sb[s]);
    if (best.get(sp[s] + '|' + sb[s]) !== s) continue; // a cheaper twin was recorded later
    if (boxes.every((b) => goal[b])) {
      let moves = '';
      for (let t = s; t > 0; t = parent[t]) moves = step[t] + moves;
      return moves;
    }
    expanded++;
    const p = sp[s];
    for (const [dx, dy, letter] of DIRS) {
      const d = dy * w + dx;
      const q = p + d;
      if (q < 0 || q >= wall.length || wall[q]) continue;
      let nb = boxes;
      let mv = letter;
      const at = boxes.indexOf(q);
      if (at >= 0) {
        if (wall[q + d] || boxes.includes(q + d)) continue;
        nb = boxes.slice();
        nb[at] = q + d;
        nb.sort((a, b) => a - b);
        mv = letter.toUpperCase();
      }
      const k = q + '|' + encode(nb);
      const seenAt = best.get(k);
      if (seenAt !== undefined && sg[seenAt] <= g + 1) continue;
      const t = sp.length;
      sp.push(q);
      sb.push(encode(nb));
      sg.push(g + 1);
      parent.push(s);
      step.push(mv);
      best.set(k, t);
      pushHeap([g + 1 + est(nb), g + 1, t]);
    }
  }
  return null;
}

// One level's moves: room by room when the level is a set of rooms, else the fallbacks.
function solve(text) {
  const level = parseLevel(text);
  const { w, wall, goals, player } = level;
  if (level.boxes.every((b) => goals.includes(b))) return '';
  const rooms = roomsOf(level);
  if (rooms !== null && rooms.length > 0) {
    let p = player;
    let moves = '';
    let boxesNow = level.boxes.slice();
    let ok = true;
    for (const room of rooms) {
      const subWall = wall.slice();
      for (const other of rooms) {
        if (other === room) continue;
        for (const b of other.done ? other.goals : other.boxes) subWall[b] = 1;
      }
      const sub = {
        w,
        h: level.h,
        wall: subWall,
        goals: room.goals.slice().sort((a, b) => a - b),
        boxes: room.boxes.slice().sort((a, b) => a - b),
        player: p,
      };
      const solved = solvePushes(sub, ROOM_STATES);
      if (solved === null) {
        ok = false;
        break;
      }
      moves += solved.moves;
      const end = endOf(w, wall, boxesNow, p, solved.moves);
      p = end.player;
      boxesNow = end.boxes;
      // The room's boxes now stand on its goals; mark the room done by its goals.
      room.done = true;
    }
    if (ok) return moves;
  }
  const whole = solvePushes(level, BOARD_STATES);
  if (whole !== null) return whole.moves;
  const any = solveMoves(level, ASTAR_STATES);
  return any ?? '';
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
