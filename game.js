(() => {
  // ====== НАСТРОЙКИ (можно менять) ======
  const N = 8;                 // размер поля
  const GAP = 2, PAD = 4;      // зазор между клетками и отступ поля
  const COLORS = ['#ff5d6c', '#ff9f43', '#ffd93d', '#4cd97b', '#3ec6ff', '#7b83ff', '#c765ff'];
  const SAVE_KEY = 'blocks_save_v1';
  const BEST_KEY = 'blocks_best_v1';

  // Фигуры: '#' - клетка, '.' - пусто
  const SHAPES = [
    ['#'],
    ['##'], ['#', '#'],
    ['###'], ['#', '#', '#'],
    ['####'], ['#', '#', '#', '#'],
    ['#####'], ['#', '#', '#', '#', '#'],
    ['##', '##'],
    ['###', '###', '###'],
    ['###', '###'], ['##', '##', '##'],
    ['#.', '##'], ['.#', '##'], ['##', '#.'], ['##', '.#'],
    ['#..', '#..', '###'], ['..#', '..#', '###'], ['###', '#..', '#..'], ['###', '..#', '..#'],
    ['#.', '#.', '##'], ['.#', '.#', '##'], ['##', '#.', '#.'], ['##', '.#', '.#'],
    ['###', '.#.'], ['.#.', '###'], ['#.', '##', '#.'], ['.#', '##', '.#'],
    ['##.', '.##'], ['.##', '##.'], ['#.', '##', '.#'], ['.#', '##', '#.']
  ];
  // ======================================

  const PARSED = SHAPES.map(rows => {
    const cells = [];
    rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') cells.push([r, c]); }));
    return { cells, h: rows.length, w: rows[0].length };
  });

  const $ = id => document.getElementById(id);
  const boardEl = $('board'), trayEl = $('tray'), scoreEl = $('score'), bestEl = $('best');
  const toastEl = $('toast'), overEl = $('over'), finalEl = $('final'), headerEl = $('header');

  let grid, pieces, score = 0, best = 0, streak = 0, missed = 0;
  let lock = false, over = false, cell = 40, drag = null;
  const cellEls = [];
  const slots = [];

  // ---------- хранилище ----------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function save() {
    if (over) { lsDel(SAVE_KEY); return; }
    lsSet(SAVE_KEY, JSON.stringify({ grid, pieces, score, streak, missed }));
  }
  function load() {
    try {
      const s = JSON.parse(lsGet(SAVE_KEY));
      if (!s || !Array.isArray(s.grid) || s.grid.length !== N || !Array.isArray(s.pieces) || s.pieces.length !== 3) return false;
      grid = s.grid; pieces = s.pieces; score = s.score | 0; streak = s.streak | 0; missed = s.missed | 0;
      return true;
    } catch (e) { return false; }
  }

  // ---------- логика ----------
  const emptyGrid = () => Array.from({ length: N }, () => Array(N).fill(0));

  function fits(g, sh, r, c) {
    if (r < 0 || c < 0 || r + sh.h > N || c + sh.w > N) return false;
    return sh.cells.every(([dr, dc]) => !g[r + dr][c + dc]);
  }
  function fullLines(g) {
    const rows = [], cols = [];
    for (let r = 0; r < N; r++) if (g[r].every(v => v)) rows.push(r);
    for (let c = 0; c < N; c++) if (g.every(row => row[c])) cols.push(c);
    return { rows, cols };
  }
  function clearFull(g) {
    const { rows, cols } = fullLines(g);
    rows.forEach(r => g[r].fill(0));
    cols.forEach(c => g.forEach(row => { row[c] = 0; }));
  }

  function solvable(g, list, budget) {
    if (!list.length) return true;
    if (--budget.n < 0) return true; // слишком много вариантов - считаем, что решаемо
    for (let k = 0; k < list.length; k++) {
      const sh = PARSED[list[k].i];
      const rest = list.filter((_, j) => j !== k);
      for (let r = 0; r <= N - sh.h; r++) {
        for (let c = 0; c <= N - sh.w; c++) {
          if (!fits(g, sh, r, c)) continue;
          const g2 = g.map(row => row.slice());
          sh.cells.forEach(([dr, dc]) => { g2[r + dr][c + dc] = 1; });
          clearFull(g2);
          if (solvable(g2, rest, budget)) return true;
        }
      }
    }
    return false;
  }

  const randPiece = () => ({ i: Math.floor(Math.random() * PARSED.length), color: Math.floor(Math.random() * COLORS.length) });

  function deal() {
    let set;
    for (let t = 0; t < 40; t++) {
      set = [randPiece(), randPiece(), randPiece()];
      if (solvable(grid, set, { n: 4000 })) break;
    }
    pieces = set;
  }

  function anyFits() {
    return pieces.some(p => {
      if (!p) return false;
      const sh = PARSED[p.i];
      for (let r = 0; r <= N - sh.h; r++)
        for (let c = 0; c <= N - sh.w; c++)
          if (fits(grid, sh, r, c)) return true;
      return false;
    });
  }

  // ---------- отрисовка ----------
  function buildBoard() {
    boardEl.innerHTML = '';
    for (let r = 0; r < N; r++) {
      cellEls[r] = [];
      for (let c = 0; c < N; c++) {
        const d = document.createElement('div');
        d.className = 'cell';
        boardEl.appendChild(d);
        cellEls[r][c] = d;
      }
    }
  }
  function renderBoard() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = grid[r][c], el = cellEls[r][c];
      el.className = 'cell' + (v ? ' on' : '');
      el.style.setProperty('--c', v ? COLORS[v - 1] : '');
    }
  }
  function buildPiece(p, size) {
    const sh = PARSED[p.i];
    const el = document.createElement('div');
    el.className = 'piece';
    el.style.gridTemplateColumns = `repeat(${sh.w},${size}px)`;
    el.style.gridTemplateRows = `repeat(${sh.h},${size}px)`;
    const set = new Set(sh.cells.map(([r, c]) => r * 10 + c));
    for (let r = 0; r < sh.h; r++) for (let c = 0; c < sh.w; c++) {
      const d = document.createElement('div');
      d.style.width = d.style.height = size + 'px';
      if (set.has(r * 10 + c)) { d.className = 'cell on'; d.style.setProperty('--c', COLORS[p.color]); }
      else d.className = 'hole';
      el.appendChild(d);
    }
    return el;
  }
  function renderTray() {
    const small = Math.floor(cell * 0.55);
    const size = small * 5 + GAP * 4;
    slots.forEach((slot, i) => {
      slot.style.width = slot.style.height = size + 'px';
      slot.innerHTML = '';
      if (pieces[i]) slot.appendChild(buildPiece(pieces[i], small));
    });
  }
  function renderHUD() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
  }
  function layout() {
    const byW = (window.innerWidth * 0.94 - PAD * 2 - GAP * (N - 1)) / N;
    const byH = (window.innerHeight * 0.5 - PAD * 2 - GAP * (N - 1)) / N;
    cell = Math.max(20, Math.floor(Math.min(byW, byH)));
    document.documentElement.style.setProperty('--cell', cell + 'px');
    const bw = cell * N + GAP * (N - 1) + PAD * 2;
    headerEl.style.width = bw + 'px';
    trayEl.style.width = bw + 'px';
    renderTray();
  }

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
  }

  // ---------- ход ----------
  function place(idx, r, c) {
    const p = pieces[idx], sh = PARSED[p.i];
    sh.cells.forEach(([dr, dc]) => { grid[r + dr][c + dc] = p.color + 1; });
    pieces[idx] = null;
    const { rows, cols } = fullLines(grid);
    const lines = rows.length + cols.length;
    let gain = sh.cells.length;
    renderBoard();
    renderTray();
    if (lines) {
      streak++; missed = 0;
      gain += 10 * lines * lines + (streak > 1 ? 10 * streak : 0);
      lock = true;
      rows.forEach(rr => cellEls[rr].forEach(el => el.classList.add('clearing')));
      cols.forEach(cc => { for (let rr = 0; rr < N; rr++) cellEls[rr][cc].classList.add('clearing'); });
      setTimeout(() => {
        rows.forEach(rr => grid[rr].fill(0));
        cols.forEach(cc => grid.forEach(row => { row[cc] = 0; }));
        renderBoard();
        afterMove(gain, lines);
      }, 260);
    } else {
      if (++missed >= 3) streak = 0;
      afterMove(gain, 0);
    }
  }

  function afterMove(gain, lines) {
    let msg = '';
    if (lines) msg = streak > 1 ? `Комбо x${streak}!\n+${gain}` : `+${gain}`;
    if (grid.every(row => row.every(v => !v))) { gain += 100; msg = 'Чистое поле!\n+' + gain; }
    score += gain;
    if (score > best) { best = score; lsSet(BEST_KEY, String(best)); }
    renderHUD();
    if (msg) toast(msg);
    if (pieces.every(p => !p)) deal();
    renderTray();
    lock = false;
    if (!anyFits()) gameOver();
    save();
  }

  function gameOver() {
    over = true;
    finalEl.textContent = score;
    overEl.classList.add('show');
    lsDel(SAVE_KEY);
  }

  function newGame() {
    grid = emptyGrid(); score = 0; streak = 0; missed = 0; over = false; lock = false;
    overEl.classList.remove('show');
    deal();
    renderBoard(); renderTray(); renderHUD(); save();
  }

  // ---------- перетаскивание ----------
  function clearPreview() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const el = cellEls[r][c], v = grid[r][c];
      el.classList.remove('ghost', 'will');
      el.style.setProperty('--c', v ? COLORS[v - 1] : '');
    }
  }
  function showPreview(t) {
    clearPreview();
    if (!t) return;
    const sh = drag.sh, col = COLORS[drag.p.color];
    const tmp = grid.map(row => row.slice());
    sh.cells.forEach(([dr, dc]) => {
      const el = cellEls[t.r + dr][t.c + dc];
      el.classList.add('ghost');
      el.style.setProperty('--c', col);
      tmp[t.r + dr][t.c + dc] = 1;
    });
    const { rows, cols } = fullLines(tmp);
    rows.forEach(r => cellEls[r].forEach(el => el.classList.add('will')));
    cols.forEach(c => { for (let r = 0; r < N; r++) cellEls[r][c].classList.add('will'); });
  }

  function startDrag(e, idx) {
    if (lock || over || drag || !pieces[idx]) return;
    e.preventDefault();
    const p = pieces[idx];
    const el = buildPiece(p, cell);
    el.classList.add('drag');
    document.body.appendChild(el);
    slots[idx].classList.add('hidden-piece');
    drag = { idx, el, p, sh: PARSED[p.i], target: null };
    moveDrag(e);
  }
  function moveDrag(e) {
    if (!drag) return;
    const w = drag.el.offsetWidth, h = drag.el.offsetHeight;
    const left = e.clientX - w / 2;
    const top = e.clientY - h - cell * 1.3; // фигура выше пальца
    drag.el.style.transform = `translate(${left}px,${top}px)`;
    const rect = boardEl.getBoundingClientRect();
    const pitch = cell + GAP;
    const c = Math.round((left - rect.left - PAD) / pitch);
    const r = Math.round((top - rect.top - PAD) / pitch);
    const t = fits(grid, drag.sh, r, c) ? { r, c } : null;
    const changed = (t && drag.target) ? (t.r !== drag.target.r || t.c !== drag.target.c) : (t !== drag.target);
    drag.target = t;
    if (changed) showPreview(t);
  }
  function endDrag() {
    if (!drag) return;
    const d = drag; drag = null;
    d.el.remove();
    clearPreview();
    slots[d.idx].classList.remove('hidden-piece');
    if (d.target) place(d.idx, d.target.r, d.target.c);
  }

  // ---------- старт ----------
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('div');
    s.className = 'slot';
    s.addEventListener('pointerdown', e => startDrag(e, i));
    trayEl.appendChild(s);
    slots.push(s);
  }
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', layout);
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('gesturestart', e => e.preventDefault());

  $('restart').addEventListener('click', () => { if (confirm('Начать заново?')) newGame(); });
  $('again').addEventListener('click', newGame);

  best = parseInt(lsGet(BEST_KEY), 10) || 0;
  buildBoard();
  layout();
  if (load()) {
    renderBoard(); renderTray(); renderHUD();
    if (!anyFits()) gameOver();
  } else {
    newGame();
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
