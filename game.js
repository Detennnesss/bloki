(() => {
  // ====== НАСТРОЙКИ (можно менять) ======
  const N = 8;                 // размер поля
  const GAP = 2, PAD = 4;      // зазор между клетками и отступ поля
  // темы: autumn - осенняя (приглушённая и тёмная), standard - исходная яркая
  const THEME_KEY = 'blocks_theme_v1';
  const PALETTES = {
    // ржавый, тыквенный, горчичный, оливковый, хвойный, слива, фиолетовый
    autumn: ['#b3402f', '#c9692a', '#cf9a33', '#7d8a37', '#3f7d73', '#8a3f6b', '#5f4b94'],
    standard: ['#ff5d6c', '#ff9f43', '#ffd93d', '#4cd97b', '#3ec6ff', '#7b83ff', '#c765ff']
  };
  const THEME_COLOR = { autumn: '#1c120d', standard: '#141a3a' }; // цвет строки состояния в браузере
  let theme = (() => { try { return localStorage.getItem(THEME_KEY) === 'standard' ? 'standard' : 'autumn'; } catch (e) { return 'autumn'; } })();
  let COLORS = PALETTES[theme];
  document.documentElement.dataset.theme = theme;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', THEME_COLOR[theme]);
  const TRAY_GAP = 14;         // минимальный зазор между фигурами внизу, px
  const ASSIST_FROM = 0.30;    // до такой заполненности поля (доля клеток) помощь минимальна
  const ASSIST_FULL = 0.65;    // начиная с такой заполненности помощь максимальна
  const ASSIST_BASE = 0.15;    // сколько помощи остаётся на почти пустом поле (0 = полный рандом)
  const EASE_SCORE = 8000;     // при каком счёте игра достигает максимальной сложности (чем больше, тем медленнее усложнение)
  const EASE_MIN = 0.3;        // минимальная «лёгкость» (0 = подбор почти случайный, 1 = максимально помогает)
  const TOUCH_GAIN_X = 1.25;   // на сколько пиксельный сдвиг фигуры больше сдвига пальца (телефон), по горизонтали
  const TOUCH_GAIN_Y = 1.55;   // то же по вертикали
  const SAVE_KEY ='blocks_save_v1';
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

  let grid = Array.from({ length: N }, () => Array(N).fill(0)), pieces = [null, null, null], score = 0, best = 0, streak = 0, missed = 0;
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

  // Оценка фигуры на текущем поле: сколько есть мест и сколько линий она может закрыть
  function pieceInfo(i) {
    const sh = PARSED[i];
    let places = 0, maxLines = 0, nice = false;
    for (let r = 0; r <= N - sh.h; r++) {
      for (let c = 0; c <= N - sh.w; c++) {
        if (!fits(grid, sh, r, c)) continue;
        places++;
        // «плотная» посадка: фигура упирается минимум в 2 занятые клетки и почти не оставляет рядом пустых
        const inPiece = new Set(sh.cells.map(([dr, dc]) => (r + dr) * 10 + c + dc));
        const nb = new Set();
        let touch = 0, exposed = 0;
        sh.cells.forEach(([dr, dc]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => {
          const nr = r + dr + a, nc = c + dc + b, key = nr * 10 + nc;
          if (nr < 0 || nc < 0 || nr >= N || nc >= N || inPiece.has(key) || nb.has(key)) return;
          nb.add(key);
          if (grid[nr][nc]) touch++; else exposed++;
        }));
        if (touch >= 2 && exposed <= 2) nice = true;
        const tmp = grid.map(row => row.slice());
        sh.cells.forEach(([dr, dc]) => { tmp[r + dr][c + dc] = 1; });
        const { rows, cols } = fullLines(tmp);
        maxLines = Math.max(maxLines, rows.length + cols.length);
      }
    }
    return { i, places, maxLines, nice };
  }

  // «Идеальные» фигуры: ищем маленькие пустые карманы на поле и фигуры, которые заполняют карман ровно
  const SHAPE_KEYS = PARSED.map(sh => normKey(sh.cells));
  function normKey(cells) {
    const mr = Math.min(...cells.map(c => c[0])), mc = Math.min(...cells.map(c => c[1]));
    return cells.map(([r, c]) => (r - mr) * 10 + (c - mc)).sort((a, b) => a - b).join(',');
  }
  function perfectShapes() {
    const seen = grid.map(row => row.map(() => false));
    const found = new Set();
    for (let r0 = 0; r0 < N; r0++) for (let c0 = 0; c0 < N; c0++) {
      if (grid[r0][c0] || seen[r0][c0]) continue;
      const comp = [], stack = [[r0, c0]];
      seen[r0][c0] = true;
      while (stack.length) {
        const [r, c] = stack.pop();
        comp.push([r, c]);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dr, dc]) => {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= N || nc >= N || grid[nr][nc] || seen[nr][nc]) return;
          seen[nr][nc] = true; stack.push([nr, nc]);
        });
      }
      if (comp.length > 9) continue; // большая открытая область - это не карман
      const key = normKey(comp);
      SHAPE_KEYS.forEach((k, i) => { if (k === key) found.add(i); });
    }
    return [...found];
  }

  // Умный подбор: фигуры, которые влезают и помогают закрывать линии, выпадают чаще
  function deal() {
    const infos = PARSED.map((_, i) => pieceInfo(i));
    const helpers = infos.filter(f => f.maxLines > 0);
    const perfect = perfectShapes();
    const niceList = infos.filter(f => f.nice).map(f => ({ ...f, size: PARSED[f.i].cells.length }));
    // лёгкость: 1 в начале игры, очень медленно падает до EASE_MIN по мере роста счёта
    // помощь зависит ещё и от заполненности поля: пока места много - почти честный рандом,
    // когда поле забивается - игра подкидывает спасительные фигуры
    const filled = grid.reduce((s, row) => s + row.filter(v => v).length, 0) / (N * N);
    const need = Math.min(1, Math.max(0, (filled - ASSIST_FROM) / (ASSIST_FULL - ASSIST_FROM)));
    const ease = Math.max(EASE_MIN, 1 - score / EASE_SCORE) * (ASSIST_BASE + (1 - ASSIST_BASE) * need);
    const weight = (f, taken) => {
      if (!f.places) return 0;
      const size = PARSED[f.i].cells.length;
      let w = (0.5 + Math.min(f.places, 20) / 20) * (1 + (f.maxLines ? 1.5 + 5 * ease : 0) + f.maxLines);
      w *= 1 + ease * 1.5 * (1 - size / 9); // в лёгком режиме мелкие и средние фигуры чаще
      if (taken.some(t => t.i === f.i)) w *= 0.3; // реже повторяем одну и ту же фигуру
      return w;
    };
    const pick = (list, taken) => {
      const ws = list.map(f => weight(f, taken));
      let sum = ws.reduce((a, b) => a + b, 0);
      if (!sum) return infos[Math.floor(Math.random() * infos.length)];
      let x = Math.random() * sum;
      for (let k = 0; k < list.length; k++) { x -= ws[k]; if (x <= 0) return list[k]; }
      return list[list.length - 1];
    };
    const color = () => Math.floor(Math.random() * COLORS.length);
    let set;
    for (let t = 0; t < 40; t++) {
      const taken = [];
      // первая фигура почти всегда та, что может закрыть линию (если на поле такие есть)
      if (perfect.length && Math.random() < 0.15 + 0.6 * ease) {
        // фигура, которая точно заполняет пустой карман: сразу видно, куда её ставить
        taken.push(infos[perfect[Math.floor(Math.random() * perfect.length)]]);
      } else {
        taken.push(helpers.length && Math.random() < 0.35 + 0.5 * ease ? pick(helpers, taken) : pick(infos, taken));
      }
      // вторая фигура: часто «плотно садится» или закрывает линию
      const goodSecond = niceList.filter(f => f.size > 1 || taken[0].i !== f.i);
      taken.push(Math.random() < 0.15 + 0.4 * ease && goodSecond.length ? pick(goodSecond, taken)
        : helpers.length && Math.random() < 0.5 * ease ? pick(helpers, taken) : pick(infos, taken));
      taken.push(pick(infos, taken));
      // перемешиваем, чтобы полезная фигура не всегда была первой слева
      taken.sort(() => Math.random() - 0.5);
      set = taken.map(f => ({ i: f.i, color: color() }));
      if (solvable(grid, set, { n: 4000 })) break;
    }
    pieces = set;
    animateTray = true; // новые фигуры появляются с анимацией
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
  let animateTray = false;
  function renderTray() {
    // три ячейки по ширине поля с зазором между ними, чтобы даже длинные фигуры (5 клеток) не соприкасались
    const bw = cell * N + GAP * (N - 1) + PAD * 2;
    const slotW = (bw - TRAY_GAP * 2) / 3;
    const small = Math.max(8, Math.min(Math.floor(cell * 0.55), Math.floor((slotW - GAP * 4) / 5)));
    const size = small * 5 + GAP * 4;
    slots.forEach((slot, i) => {
      slot.style.width = slot.style.height = size + 'px';
      slot.innerHTML = '';
      if (pieces[i]) {
        const pe = buildPiece(pieces[i], small);
        if (animateTray) { pe.classList.add("enter"); pe.style.animationDelay = i * 90 + "ms"; }
        slot.appendChild(pe);
      }
    });
    animateTray = false;
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

  // ---------- звуки (глухие «пузырьки») ----------
  let actx = null;
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { actx = new AC(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  // f - начальная частота, rise - во сколько раз поднимается тон, dur - длина, vol - громкость, delay - задержка
  const SFX_KEY = 'blocks_sfx_v1';
  let sfxOn = lsGet(SFX_KEY) !== '0';
  function bubble(f, rise, dur, vol, delay) {
    if (!sfxOn) return;
    const a = audio(); if (!a) return;
    const t = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain(), lp = a.createBiquadFilter();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * rise, t + dur * 0.7);
    lp.type = 'lowpass'; lp.frequency.value = 1100;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // лёгкая вибрация (работает на Android; iPhone Safari её не поддерживает)
  function buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }
  const sfx = {
    place() { bubble(170, 1.5, 0.14, 0.5); buzz(12); },
    clear(lines, streak) {
      const base = 230 + Math.min(streak, 6) * 25;
      for (let i = 0; i < Math.min(lines, 4) + 1; i++) bubble(base * Math.pow(1.19, i), 1.7, 0.18, 0.4, i * 0.07);
    },
    perfect() { [260, 330, 390, 520].forEach((f, i) => bubble(f, 1.6, 0.22, 0.4, i * 0.09)); },
    restart() { [200, 300].forEach((f, i) => bubble(f, 1.8, 0.16, 0.45, i * 0.08)); },
    over() { [300, 230, 170].forEach((f, i) => bubble(f, 0.7, 0.28, 0.45, i * 0.14)); }
  };
  // ---------- фоновый лёгкий джаз (генерируется на лету, без файлов) ----------
  const MUSIC_KEY = 'blocks_music_v1';
  const MUSIC_VOL = 0.9;                        // общая громкость музыки
  const BPM = 84, STEP = 60 / BPM / 3;          // сетка триолей: отсюда «свинг»
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  // 8 тактов: Dm7 G7 Cmaj7 Am7 | Dm7 G7 Cmaj7 A7. root - бас, v - аккорд, mel - ноты для мелодии
  const PROG = [
    { root: 38, v: [53, 57, 60, 64], mel: [69, 72, 74, 76, 77, 79] },
    { root: 43, v: [53, 59, 64, 69], mel: [67, 69, 71, 74, 77, 79] },
    { root: 36, v: [52, 55, 59, 62], mel: [67, 71, 72, 74, 76, 79] },
    { root: 45, v: [55, 60, 64, 67], mel: [69, 72, 74, 76, 79, 81] },
    { root: 38, v: [53, 57, 60, 64], mel: [69, 72, 74, 76, 77, 79] },
    { root: 43, v: [53, 59, 64, 69], mel: [67, 69, 71, 74, 77, 79] },
    { root: 36, v: [52, 55, 59, 62], mel: [67, 71, 72, 74, 76, 79] },
    { root: 45, v: [55, 61, 64, 66], mel: [69, 71, 73, 76, 79, 81] }
  ];
  let musicOn = lsGet(MUSIC_KEY) !== '0', musicStarted = false;
  let mTimer = null, mStep = 0, mNext = 0, mGain = null, mNoise = null, mRest = 0;

  function mOut(a) {
    if (!mGain) { mGain = a.createGain(); mGain.gain.value = MUSIC_VOL; mGain.connect(a.destination); }
    return mGain;
  }
  function epiano(m, t, dur, vol) {
    const a = actx, out = mOut(a), f = hz(m);
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g); g.connect(out);
    [[1, 1, 'sine'], [2, 0.22, 'sine'], [1.003, 0.5, 'triangle']].forEach(([mul, amp, type]) => {
      const o = a.createOscillator(), og = a.createGain();
      o.type = type; o.frequency.value = f * mul; og.gain.value = amp;
      o.connect(og); og.connect(lp);
      o.start(t); o.stop(t + dur + 0.05);
    });
  }
  function bassNote(m, t, dur, vol) {
    const a = actx, out = mOut(a);
    const o = a.createOscillator(), o2 = a.createOscillator(), g = a.createGain(), lp = a.createBiquadFilter();
    o.type = 'sine'; o2.type = 'triangle';
    o.frequency.value = hz(m); o2.frequency.value = hz(m);
    lp.type = 'lowpass'; lp.frequency.value = 500;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  function ride(t, vol) {
    const a = actx, out = mOut(a);
    if (!mNoise) {
      mNoise = a.createBuffer(1, a.sampleRate * 0.3, a.sampleRate);
      const d = mNoise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = a.createBufferSource(), hp = a.createBiquadFilter(), g = a.createGain();
    s.buffer = mNoise; hp.type = 'highpass'; hp.frequency.value = 6500;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    s.connect(hp); hp.connect(g); g.connect(out);
    s.start(t); s.stop(t + 0.2);
  }

  function musicStep(n, t) {
    const bar = Math.floor(n / 12) % PROG.length, s = n % 12;
    const beat = Math.floor(s / 3), sub = s % 3;
    const ch = PROG[bar], next = PROG[(bar + 1) % PROG.length];
    // ride: четвертные + «подпрыгивающая» нота на 2 и 4 долях
    if (sub === 0) ride(t, 0.042);
    if (sub === 2 && (beat === 1 || beat === 3)) ride(t, 0.028);
    // ходящий бас
    if (sub === 0) {
      const m = beat === 0 ? ch.root
        : beat === 1 ? ch.root + [3, 4, 7][Math.floor(Math.random() * 3)]
        : beat === 2 ? ch.root + 7
        : next.root + (Math.random() < 0.5 ? 1 : -1); // подход к следующему аккорду
      bassNote(m, t, STEP * 3 * 0.9, 0.10);
    }
    // аккорды «чарльстоном»
    if (s === 0 || (s === 5 && Math.random() < 0.8) || (s === 11 && Math.random() < 0.3)) {
      ch.v.forEach((m, i) => epiano(m, t + i * 0.012, STEP * 5, 0.05));
    }
    // редкая мягкая мелодия
    if (mRest > 0) mRest--;
    else if ((sub === 0 || sub === 2) && Math.random() < 0.2) {
      const m = ch.mel[Math.floor(Math.random() * ch.mel.length)];
      epiano(m, t, STEP * (3 + Math.floor(Math.random() * 4)), 0.07);
      mRest = 3 + Math.floor(Math.random() * 5);
    }
  }
  function musicTick() {
    const a = actx; if (!a) return;
    while (mNext < a.currentTime + 0.3) { musicStep(mStep++, mNext); mNext += STEP; }
  }
  let mStopT = null;
  function startMusic() {
    if (!musicOn || !musicStarted) return;
    const a = audio(); if (!a) return;
    clearTimeout(mStopT);
    const g = mOut(a).gain, now = a.currentTime;
    g.cancelScheduledValues(now);
    if (!mTimer) {
      g.setValueAtTime(0.0001, now);
      mNext = now + 0.1;
      mTimer = setInterval(musicTick, 60);
    } else g.setValueAtTime(Math.max(g.value, 0.0001), now); // музыка ещё не успела затихнуть - просто возвращаем громкость
    g.linearRampToValueAtTime(MUSIC_VOL, now + 1); // плавное нарастание
  }
  function stopMusic() { clearInterval(mTimer); mTimer = null; clearTimeout(mStopT); }
  // плавное затухание (например, при проигрыше), потом остановка
  function fadeMusic(sec) {
    if (!mTimer || !mGain || !actx) return;
    const g = mGain.gain, now = actx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.linearRampToValueAtTime(0.0001, now + sec);
    clearTimeout(mStopT);
    mStopT = setTimeout(stopMusic, sec * 1000 + 100);
  }
  document.addEventListener('visibilitychange', () => { document.hidden ? stopMusic() : startMusic(); });

  // браузеры разрешают звук только после касания
  window.addEventListener('pointerdown', audio, { once: true });

  // ---------- цвет фона ----------
  // осенние оттенки: бордовый, ржавый, тыквенный, янтарный, коричневый, «хэллоуинский» фиолетовый
  const HUES = [350, 10, 22, 32, 42, 275];
  const HUE_KEY = 'blocks_hue_v2';
  const mod360 = h => ((h % 360) + 360) % 360;
  // в осенней теме оттенки только из списка, в стандартной - любые
  const randHue = () => theme === 'autumn' ? HUES[Math.floor(Math.random() * HUES.length)] : Math.floor(Math.random() * 360);
  let hue = parseInt(lsGet(HUE_KEY), 10);
  // при запуске: если есть незавершённая игра - её цвет, иначе случайный
  if (isNaN(hue) || !lsGet(SAVE_KEY)) hue = randHue();
  document.documentElement.style.setProperty('--hue', hue);
  function setHue(target) {
    // идём кратчайшим путём по кругу, но без накопления, чтобы переход оставался плавным
    hue += ((target - hue) % 360 + 540) % 360 - 180;
    document.documentElement.style.setProperty('--hue', hue);
    lsSet(HUE_KEY, String(mod360(hue)));
  }
  function nextHue() {
    if (theme === 'standard') { setHue(hue + 50 + Math.floor(Math.random() * 100)); return; }
    let target;
    do { target = randHue(); } while (target === mod360(hue));
    setHue(target);
  }
  // смена темы: перекрашиваем поле и фигуры, фон подстраиваем под тему
  function applyTheme(t) {
    theme = t;
    lsSet(THEME_KEY, t);
    COLORS = PALETTES[t];
    const root = document.documentElement;
    root.classList.add('recolor');
    clearTimeout(applyTheme.t);
    applyTheme.t = setTimeout(() => root.classList.remove('recolor'), 900);
    trayEl.classList.remove('swap'); void trayEl.offsetWidth; trayEl.classList.add('swap');
    root.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[t]);
    if (t === 'autumn' && !HUES.includes(mod360(hue))) {
      // ближайший осенний оттенок
      const dist = h => Math.min(Math.abs(h - mod360(hue)), 360 - Math.abs(h - mod360(hue)));
      setHue(HUES.reduce((best, h) => dist(h) < dist(best) ? h : best));
    }
    renderBoard(); renderTray();
  }

  // ---------- паутина по углам ----------
  (function webs() {
    const S = 200, spokes = 6, rings = [28, 58, 92, 130, 172];
    const pt = (r, deg) => [(r * Math.cos(deg * Math.PI / 180)).toFixed(1), (r * Math.sin(deg * Math.PI / 180)).toFixed(1)];
    let d = '';
    for (let k = 0; k <= spokes; k++) d += `M0 0L${pt(S, k * 90 / spokes).join(' ')}`;
    rings.forEach(r => {
      for (let k = 0; k < spokes; k++) {
        const [x1, y1] = pt(r, k * 90 / spokes), [x2, y2] = pt(r, (k + 1) * 90 / spokes);
        const [cx, cy] = pt(r * 0.8, (k + 0.5) * 90 / spokes); // прогиб нити к углу
        d += `M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}`;
      }
    });
    const svg = `<svg viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/></svg>`;
    ['tl', 'tr', 'bl', 'br'].forEach(pos => {
      const el = document.createElement('div');
      el.className = 'web ' + pos;
      el.innerHTML = svg;
      document.body.insertBefore(el, document.body.firstChild);
    });
  })();

  // ---------- осенний декор: падающие листья ----------
  (function leaves() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = $('leaves');
    const ICONS = ['🍂', '🍁', '🍂', '🍁', '🍂', '🍁', '🎃', '🦇'];
    for (let i = 0; i < 16; i++) {
      const el = document.createElement('span');
      const icon = ICONS[Math.floor(Math.random() * ICONS.length)];
      el.textContent = icon;
      el.className = 'leaf' + (icon === '🦇' ? ' bat' : '');
      const size = 16 + Math.random() * 20;
      el.style.left = Math.random() * 100 + 'vw';
      el.style.fontSize = size + 'px';
      el.style.opacity = (0.35 + Math.random() * 0.4).toFixed(2);
      el.style.setProperty('--sx', (20 + Math.random() * 50) + 'px');
      el.style.animationDuration = (14 + Math.random() * 14) + 's';
      el.style.animationDelay = -Math.random() * 28 + 's';
      if (size < 22) el.style.filter = 'blur(1px)';
      box.appendChild(el);
    }
  })();

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
    sfx.place();
    if (lines) {
      streak++; missed = 0;
      sfx.clear(lines, streak);
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
    if (grid.every(row => row.every(v => !v))) { gain += 100; msg = 'Чистое поле!\n+' + gain; nextHue(); sfx.perfect(); }
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
    sfx.over();
    fadeMusic(1.6);
    finalEl.textContent = score;
    overEl.classList.add('show');
    lsDel(SAVE_KEY);
  }

  function newGame(initial) {
    if (initial !== true) { nextHue(); sfx.restart(); musicStarted = true; startMusic(); } // новая игра после проигрыша/рестарта: плавная смена цвета
    grid = emptyGrid(); score = 0; streak = 0; missed = 0; over = false; lock = false;
    if (overEl.classList.contains('show')) {
      overEl.classList.add('closing');
      setTimeout(() => overEl.classList.remove('show', 'closing'), 220);
    }
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
    drag = { idx, el, p, sh: PARSED[p.i], target: null, sx: e.clientX, sy: e.clientY, touch: e.pointerType === 'touch' };
    if (drag.touch) {
      // на телефоне фигура стартует из своей ячейки и двигается быстрее пальца
      const sr = slots[idx].getBoundingClientRect();
      drag.ax = sr.left + sr.width / 2 - drag.el.offsetWidth / 2;
      drag.ay = sr.top + sr.height / 2 - drag.el.offsetHeight / 2 - cell * 1.3;
    }
    moveDrag(e);
  }
  function moveDrag(e) {
    if (!drag) return;
    const w = drag.el.offsetWidth, h = drag.el.offsetHeight;
    let left, top;
    if (drag.touch) {
      left = drag.ax + (e.clientX - drag.sx) * TOUCH_GAIN_X;
      top = drag.ay + (e.clientY - drag.sy) * TOUCH_GAIN_Y;
      left = Math.max(0, Math.min(window.innerWidth - w, left));
      top = Math.max(0, Math.min(window.innerHeight - h, top));
    } else {
      left = e.clientX - w / 2;
      top = e.clientY - h - cell * 1.3; // фигура выше пальца
    }
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

  // ---------- настройки ----------
  const settingsEl = $('settings'), swMusic = $('swMusic'), swSfx = $('swSfx');
  const swTheme = $('swTheme');
  swTheme.addEventListener('click', () => {
    applyTheme(theme === 'autumn' ? 'standard' : 'autumn');
    syncSwitches();
  });
  const syncSwitches = () => {
    swTheme.classList.toggle('on', theme === 'autumn'); swTheme.setAttribute('aria-checked', theme === 'autumn');
    swMusic.classList.toggle('on', musicOn); swMusic.setAttribute('aria-checked', musicOn);
    swSfx.classList.toggle('on', sfxOn); swSfx.setAttribute('aria-checked', sfxOn);
  };
  syncSwitches();
  swMusic.addEventListener('click', () => {
    musicOn = !musicOn;
    lsSet(MUSIC_KEY, musicOn ? '1' : '0');
    syncSwitches();
    if (musicOn) startMusic(); else stopMusic();
  });
  swSfx.addEventListener('click', () => {
    sfxOn = !sfxOn;
    lsSet(SFX_KEY, sfxOn ? '1' : '0');
    syncSwitches();
    sfx.place(); // короткий «бульк» как пример, если звуки включили
  });
  $('settingsBtn').addEventListener('click', () => settingsEl.classList.add('show'));
  $('settingsClose').addEventListener('click', () => {
    settingsEl.classList.add('closing');
    setTimeout(() => settingsEl.classList.remove('show', 'closing'), 220);
  });

  $('restart').addEventListener('click', () => { if (confirm('Начать заново?')) newGame(); });
  $('again').addEventListener('click', newGame);

  best = parseInt(lsGet(BEST_KEY), 10) || 0;
  buildBoard();
  layout();
  // при каждом заходе показываем экран «Старт»: с сохранённой партией он её продолжает, иначе начинает новую
  const resumed = load();
  renderBoard(); renderTray(); renderHUD();
  if (resumed && !anyFits()) {
    gameOver();
  } else {
    const startEl = $('start');
    startEl.classList.add('show');
    lock = true; // нельзя тянуть фигуры до старта
    $('startBtn').addEventListener('click', () => {
      sfx.restart();
      musicStarted = true; startMusic(); // музыку можно запускать только после касания
      startEl.classList.add('closing');
      setTimeout(() => startEl.classList.remove('show', 'closing'), 220);
      lock = false;
      if (!resumed) newGame(true);
    });
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
