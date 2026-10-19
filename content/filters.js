// Панель «Фильтры видео» поверх YouTube: пресеты, свои фильтры, сортировка, CSV.
// Обычный контент-скрипт (не модуль). Данные — через background.js (filterVideos).
(() => {
  if (window.__tlFiltersLoaded) return;
  window.__tlFiltersLoaded = true;

  // ---------- helpers ----------
  const send = (msg) =>
    new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (r?.error) return reject(Object.assign(new Error(r.error), { code: r.code }));
          resolve(r?.data);
        });
      } catch (e) {
        // контекст расширения потерян (обновили расширение без перезагрузки вкладки)
        reject(new Error('Расширение было обновлено — перезагрузите страницу.'));
      }
    });

  const IC = {
    filter: '<path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/>',
    logo: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="m9 8 4 2.5L9 13z"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-7"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4v1a4 4 0 0 0 4 4"/><path d="M16 6h4v1a4 4 0 0 1-4 4"/><path d="M12 13v4"/><path d="M8 21h8"/><path d="M10 17h4v4h-4z"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="m11 9 3 2-3 2z"/>',
    rocket: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    gem: '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18"/><path d="m9 3-1.5 6L12 21l4.5-12L15 3"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19 13 11"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    channel: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
  };
  const ic = (n, s = 16) =>
    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${IC[n]}</svg>`;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (n) => {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n), f = (x, s) => x.toFixed(1).replace(/\.0$/, '') + s;
    return a >= 1e9 ? f(n / 1e9, 'B') : a >= 1e6 ? f(n / 1e6, 'M') : a >= 1e3 ? f(n / 1e3, 'K') : String(Math.round(n));
  };
  const fmtX = (n) => (n >= 10 ? Math.round(n) : n >= 0.95 || n === 0 ? n.toFixed(1) : n.toFixed(2)) + 'x';
  // VPH: малые значения с десятыми, чтобы не было «0 VPH»
  const fmtV = (n) => (n > 0 && n < 10 ? n.toFixed(1).replace(/\.0$/, '') : fmt(n));
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    return b === 1 ? one : many;
  };
  const viewsText = (n) => {
    if (n == null) return 'нет данных о просмотрах';
    return n >= 1000 ? `${fmt(n)} просмотров` : `${n} ${plural(n, 'просмотр', 'просмотра', 'просмотров')}`;
  };
  const dur = (s) => {
    if (!s || s <= 0) return '';
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60, p = (v) => String(v).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
  };
  // «10K», «1,5 млн», «20 тыс» → число; '' → null; мусор → NaN
  const parseNum = (raw) => {
    const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
    if (!s) return null;
    const m = s.match(/^(\d+(?:\.\d+)?)(k|к|тыс\.?|m|м|млн\.?|b|млрд\.?)?$/);
    if (!m) return NaN;
    const u = (m[2] || '').replace('.', '');
    const mult = { k: 1e3, 'к': 1e3, 'тыс': 1e3, m: 1e6, 'м': 1e6, 'млн': 1e6, b: 1e9, 'млрд': 1e9 }[u] || 1;
    return parseFloat(m[1]) * mult;
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим и т.п. */ } };

  const H = 1, DAY = 24, WEEK = 168, MONTH = 720, YEAR = 8760;

  // ---------- пресеты ----------
  // fetch — параметры запроса для поиска; age — эквивалентный клиентский фильтр для канала.
  const PRESETS = [
    { id: 'all', icon: 'grid', title: 'Все видео', desc: 'Без фильтров', sort: 'default' },
    { id: 'new', icon: 'clock', title: 'Новые', desc: 'Загружены за 7 дней', fetch: { date: 3, sort: 2 }, age: WEEK, sort: 'date' },
    { id: 'outliers', icon: 'target', title: 'Аутсайдеры', desc: 'Хиты каналов до 50K подп.', test: (v) => v.subs != null && v.subs <= 50000 && v.ratio != null && v.ratio >= 1, sort: 'ratio' },
    { id: 'top24', icon: 'trophy', title: 'Топ за сутки', desc: 'Лидеры просмотров за 24 ч', fetch: { date: 2, sort: 3 }, age: DAY, sort: 'views' },
    { id: 'shorts', icon: 'phone', title: 'Shorts в тренде', desc: 'До 3 минут, по VPH', test: (v) => v.duration > 0 && v.duration <= 180, sort: 'vph' },
    { id: 'rising', icon: 'rocket', title: 'Взлетают', desc: 'До 30 дней, быстрый рост', test: (v) => v.ageHours != null && v.ageHours <= MONTH, sort: 'vph' },
    { id: 'gems', icon: 'gem', title: 'Скрытые жемчужины', desc: '×3 к медиане, до 100K подп.', test: (v) => v.out != null && v.out >= 3 && v.subs != null && v.subs <= 100000, sort: 'out' },
    { id: 'evergreen', icon: 'leaf', title: 'Вечнозелёные', desc: 'Старше года, от 10 VPH', test: (v) => v.ageHours != null && v.ageHours >= YEAR && v.vph != null && v.vph >= 10, sort: 'vph' },
  ];
  const presetById = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

  const SORTS = [
    ['default', 'По умолчанию'], ['vph', 'VPH'], ['views', 'Просмотры'], ['out', 'Множитель ×'], ['ratio', 'Просмотры/подписчики'], ['date', 'Дата'],
  ];

  const CUSTOM_KEY = 'tubelens.filters.custom';
  const EMPTY_CUSTOM = { minViews: '', maxViews: '', minSubs: '', maxSubs: '', minVph: '', minOut: '', minRatio: '', age: '', dur: '' };
  const AGE_OPTS = [['', 'Любое время'], ['24', 'За 24 часа'], ['168', 'За 7 дней'], ['720', 'За 30 дней'], ['8760', 'За год'], ['old', 'Старше года']];
  const DUR_OPTS = [['', 'Любая'], ['short', 'Shorts ≤ 3 мин'], ['mid', '4–20 мин'], ['long', 'Больше 20 мин']];
  const NUM_FIELDS = [
    ['minViews', 'Просмотры от', 'напр. 10K'], ['maxViews', 'Просмотры до', 'напр. 1M'],
    ['minSubs', 'Подписчики от', 'напр. 1K'], ['maxSubs', 'Подписчики до', 'напр. 100K'],
    ['minVph', 'VPH от', 'напр. 50'], ['minOut', 'Множитель × от', 'напр. 2'],
    ['minRatio', 'Просм./подп. от', 'напр. 1'],
  ];

  // ---------- состояние ----------
  const S = {
    open: false,
    src: null, // { kind: 'search', q } | { kind: 'channel', href }
    pageChannel: null, // href канала текущей страницы, если есть
    max: 60,
    preset: 'all',
    sort: 'default',
    text: '',
    custom: { ...EMPTY_CUSTOM, ...(lsGet(CUSTOM_KEY) || {}) },
    customOpen: true,
    data: null, // ответ filterVideos
    dataKey: '',
    loading: false,
    error: null,
    req: 0,
    cache: new Map(),
    view: [], // текущие отфильтрованные строки
    restoreFocus: null,
    prevOverflow: null,
  };
  const SEARCH_MAX = 200, SEARCH_STEP = 30, SEARCH_START = 60, CH_START = 120, CH_STEP = 120, CH_MAX = 500;

  // ---------- источник по текущей странице ----------
  const channelHrefFromPath = (p) => {
    const m = p.match(/^\/(@[^/?#]+|channel\/UC[\w-]+|c\/[^/?#]+|user\/[^/?#]+)/);
    return m ? '/' + m[1] : null;
  };
  function pageSource() {
    const p = location.pathname;
    if (p === '/results') {
      const q = new URLSearchParams(location.search).get('search_query');
      return q ? { kind: 'search', q } : null;
    }
    const href = channelHrefFromPath(p);
    return href ? { kind: 'channel', href } : null;
  }

  const fetchParams = () => {
    const p = presetById(S.preset);
    if (!S.src) return null;
    if (S.src.kind === 'channel') return { type: 'filterVideos', source: 'channel', href: S.src.href, max: S.max };
    return { type: 'filterVideos', source: 'search', q: S.src.q, max: S.max, sort: p.fetch?.sort || 0, date: p.fetch?.date || 0 };
  };
  const keyOf = (m) => (m ? JSON.stringify([m.source, m.q || m.href, m.max, m.sort || 0, m.date || 0]) : '');
  const srcKey = (src) => (src ? src.kind + '|' + (src.q || src.href) : '');

  // ---------- DOM ----------
  let root, $;

  function build() {
    root = document.createElement('div');
    root.id = 'tl-filters';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'TubeLens — фильтры видео');
    const field = ([k, label, ph]) =>
      `<label class="tlf-field"><span>${esc(label)}</span><input type="text" inputmode="decimal" autocomplete="off" data-c="${k}" placeholder="${esc(ph)}"></label>`;
    const sel = (k, label, opts) =>
      `<label class="tlf-field tlf-wide"><span>${esc(label)}</span><select data-c="${k}">${opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></label>`;
    root.innerHTML = `
      <aside class="tlf-side" aria-label="Фильтры">
        <div class="tlf-brand"><span class="tlf-logo">${ic('logo', 18)}</span><b>TubeLens</b><span>Фильтры видео</span></div>
        <div class="tlf-h" id="tlf-presets-h">Пресеты</div>
        <div class="tlf-presets" role="group" aria-labelledby="tlf-presets-h">
          ${PRESETS.map((p) => `<button type="button" class="tlf-preset" data-p="${p.id}" aria-pressed="false">
            <span class="tlf-pi">${ic(p.icon, 18)}</span><span class="tlf-pt"><b>${esc(p.title)}</b><small>${esc(p.desc)}</small></span></button>`).join('')}
        </div>
        <button type="button" class="tlf-h tlf-toggle" aria-expanded="true" aria-controls="tlf-custom">
          <span>Свои фильтры</span><span class="tlf-ccount" hidden></span><span class="tlf-sp"></span><span class="tlf-chev">${ic('chevron', 16)}</span>
        </button>
        <div class="tlf-custom" id="tlf-custom">
          <div class="tlf-fields">${NUM_FIELDS.map(field).join('')}
            ${sel('age', 'Опубликовано', AGE_OPTS)}
            ${sel('dur', 'Длительность', DUR_OPTS)}
          </div>
          <div class="tlf-hint">Можно писать 10K, 1,5M, 20 тыс. Применяется сразу.</div>
          <button type="button" class="tlf-btn tlf-reset">${ic('reset', 14)}<span>Сброс</span></button>
        </div>
      </aside>
      <section class="tlf-main">
        <header class="tlf-top">
          <form class="tlf-qform" role="search">
            <span class="tlf-qi">${ic('search', 16)}</span>
            <input type="search" class="tlf-q" placeholder="Поиск видео на YouTube" aria-label="Запрос для поиска" autocomplete="off">
            <button type="submit" class="tlf-btn tlf-primary">Найти</button>
          </form>
          <button type="button" class="tlf-btn tlf-chsrc" hidden>${ic('channel', 14)}<span>Видео канала</span></button>
          <div class="tlf-src" aria-live="polite"></div>
          <span class="tlf-sp"></span>
          <button type="button" class="tlf-close" aria-label="Закрыть (Esc)" title="Закрыть (Esc)">${ic('close', 20)}</button>
        </header>
        <div class="tlf-bar">
          <label class="tlf-sortl"><span>Сортировка</span>
            <select class="tlf-sort">${SORTS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>
          </label>
          <input type="search" class="tlf-text" placeholder="Искать в названиях" aria-label="Фильтр по названию" autocomplete="off">
          <span class="tlf-count" aria-live="polite"></span>
          <span class="tlf-sp"></span>
          <button type="button" class="tlf-btn tlf-more">${ic('plus', 14)}<span>Загрузить ещё</span></button>
          <button type="button" class="tlf-btn tlf-csv">${ic('download', 14)}<span>Скачать CSV</span></button>
        </div>
        <div class="tlf-progress" hidden><i></i></div>
        <div class="tlf-body">
          <div class="tlf-state" hidden></div>
          <div class="tlf-grid" role="list"></div>
        </div>
      </section>`;
    document.body.appendChild(root);
    $ = (s) => root.querySelector(s);

    // пресеты
    root.querySelectorAll('.tlf-preset').forEach((b) => b.addEventListener('click', () => setPreset(b.dataset.p)));
    // свои фильтры
    $('.tlf-toggle').addEventListener('click', () => { S.customOpen = !S.customOpen; renderSide(); });
    const onCustom = debounce(() => { readCustom(); lsSet(CUSTOM_KEY, S.custom); renderSide(); renderGrid(); }, 150);
    root.querySelectorAll('[data-c]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', onCustom));
    $('.tlf-reset').addEventListener('click', () => {
      S.custom = { ...EMPTY_CUSTOM };
      lsSet(CUSTOM_KEY, S.custom);
      writeCustom(); renderSide(); renderGrid();
    });
    // запрос
    $('.tlf-qform').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('.tlf-q').value.trim();
      if (!q) { $('.tlf-q').focus(); return; }
      setSource({ kind: 'search', q });
    });
    $('.tlf-chsrc').addEventListener('click', () => { if (S.pageChannel) setSource({ kind: 'channel', href: S.pageChannel }); });
    // сортировка / текст
    $('.tlf-sort').addEventListener('change', (e) => { S.sort = e.target.value; renderGrid(); });
    $('.tlf-text').addEventListener('input', debounce((e) => { S.text = e.target.value.trim().toLowerCase(); renderGrid(); }, 120));
    $('.tlf-more').addEventListener('click', loadMore);
    $('.tlf-csv').addEventListener('click', downloadCsv);
    $('.tlf-close').addEventListener('click', close);
    // карточки
    const grid = $('.tlf-grid');
    grid.addEventListener('click', (e) => {
      const an = e.target.closest('.tlf-an');
      if (an) {
        e.preventDefault();
        send({ type: 'open', route: 'video?id=' + an.dataset.id }).catch((err) => toast(err.message));
        return;
      }
      if (e.target.closest('a')) { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) close(); return; }
      const card = e.target.closest('.tlf-card');
      if (card) { close(); location.href = '/watch?v=' + encodeURIComponent(card.dataset.id); }
    });
    // битая аватарка канала → кружок с буквой
    grid.addEventListener('error', (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.classList.contains('tlf-av')) return;
      const s = document.createElement('span');
      s.className = 'tlf-av tlf-av0';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = (img.closest('.tlf-chrow')?.querySelector('.tlf-chname')?.textContent || '?').trim().charAt(0).toUpperCase();
      img.replaceWith(s);
    }, true);
    $('.tlf-body').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'retry') load(true);
      if (b.dataset.act === 'clear') clearFilters();
      if (b.dataset.act === 'focus') $('.tlf-q').focus();
    });
    // клавиатура: горячие клавиши YouTube не должны срабатывать, пока открыта панель
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') trapTab(e);
      if (e.key !== 'Escape') e.stopPropagation();
    });
    root.addEventListener('keypress', (e) => e.stopPropagation());
    root.addEventListener('keyup', (e) => e.stopPropagation());
    writeCustom();
  }

  function trapTab(e) {
    const els = [...root.querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function toast(msg) {
    let t = root.querySelector('.tlf-toast');
    if (!t) { t = document.createElement('div'); t.className = 'tlf-toast'; t.setAttribute('role', 'status'); root.appendChild(t); }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('on'), 2600);
  }

  // ---------- свои фильтры ----------
  function readCustom() {
    root.querySelectorAll('[data-c]').forEach((el) => {
      S.custom[el.dataset.c] = el.value;
      if (el.tagName === 'INPUT') {
        const bad = Number.isNaN(parseNum(el.value));
        el.toggleAttribute('aria-invalid', bad);
        el.title = bad ? 'Не понимаю число — например 10K или 1500' : '';
      }
    });
  }
  function writeCustom() {
    root.querySelectorAll('[data-c]').forEach((el) => {
      el.value = S.custom[el.dataset.c] ?? '';
      if (el.tagName === 'INPUT') el.toggleAttribute('aria-invalid', Number.isNaN(parseNum(el.value)));
    });
  }
  const customCount = () => Object.entries(S.custom).filter(([k, v]) => {
    if (!String(v).trim()) return false;
    if (k === 'age' || k === 'dur') return true;
    const n = parseNum(v);
    return n != null && !Number.isNaN(n);
  }).length;

  function clearFilters() {
    S.custom = { ...EMPTY_CUSTOM };
    lsSet(CUSTOM_KEY, S.custom);
    writeCustom();
    S.text = ''; $('.tlf-text').value = '';
    if (S.preset !== 'all') setPreset('all');
    else { renderSide(); renderGrid(); }
  }

  // ---------- фильтрация / сортировка ----------
  function predicates() {
    const out = [];
    const p = presetById(S.preset);
    if (p.test) out.push(p.test);
    // для канала «датные» пресеты превращаются в клиентский фильтр по возрасту
    if (p.age && S.src?.kind === 'channel') out.push((v) => v.ageHours != null && v.ageHours <= p.age);
    const c = S.custom, n = (k) => { const x = parseNum(c[k]); return x == null || Number.isNaN(x) ? null : x; };
    const min = (field, k) => { const x = n(k); if (x != null) out.push((v) => v[field] != null && v[field] >= x); };
    const max = (field, k) => { const x = n(k); if (x != null) out.push((v) => v[field] != null && v[field] <= x); };
    min('views', 'minViews'); max('views', 'maxViews');
    min('subs', 'minSubs'); max('subs', 'maxSubs');
    min('vph', 'minVph'); min('out', 'minOut'); min('ratio', 'minRatio');
    if (c.age === 'old') out.push((v) => v.ageHours != null && v.ageHours >= YEAR);
    else if (c.age) { const h = +c.age; out.push((v) => v.ageHours != null && v.ageHours <= h); }
    if (c.dur === 'short') out.push((v) => v.duration > 0 && v.duration <= 180);
    if (c.dur === 'mid') out.push((v) => v.duration >= 240 && v.duration <= 1200);
    if (c.dur === 'long') out.push((v) => v.duration > 1200);
    if (S.text) {
      const words = S.text.split(/\s+/).filter(Boolean);
      out.push((v) => { const t = String(v.title || '').toLowerCase(); return words.every((w) => t.includes(w)); });
    }
    return out;
  }

  const timeOf = (v) => {
    const t = v.publishedAt ? Date.parse(v.publishedAt) : NaN;
    if (!Number.isNaN(t)) return t;
    return v.ageHours != null ? Date.now() - v.ageHours * 3600e3 : null;
  };

  function computeView() {
    const all = S.data?.videos || [];
    const preds = predicates();
    const rows = all.filter((v) => preds.every((f) => f(v)));
    const key = { vph: (v) => v.vph, views: (v) => v.views, out: (v) => v.out, ratio: (v) => v.ratio, date: timeOf }[S.sort];
    if (key) {
      rows.sort((a, b) => {
        const x = key(a), y = key(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return y - x;
      });
    }
    return rows;
  }

  // ---------- рендер ----------
  function renderSide() {
    root.querySelectorAll('.tlf-preset').forEach((b) => {
      const on = b.dataset.p === S.preset;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const t = $('.tlf-toggle');
    t.setAttribute('aria-expanded', String(S.customOpen));
    root.classList.toggle('tlf-collapsed', !S.customOpen);
    const n = customCount(), cc = $('.tlf-ccount');
    cc.hidden = !n;
    cc.textContent = n;
    cc.title = n ? `Активно фильтров: ${n}` : '';
  }

  function renderTop() {
    const src = S.src;
    const q = $('.tlf-q');
    if (src?.kind === 'search' && document.activeElement !== q) q.value = src.q;
    const chBtn = $('.tlf-chsrc');
    chBtn.hidden = !S.pageChannel || (src?.kind === 'channel' && src.href === S.pageChannel);
    const info = $('.tlf-src');
    if (!src) info.textContent = '';
    else if (src.kind === 'channel') info.innerHTML = `${ic('channel', 14)}<span>Канал: <b>${esc(S.data?.title || src.href.replace(/^\//, ''))}</b></span>`;
    else info.innerHTML = `${ic('search', 14)}<span>Поиск: <b>${esc(src.q)}</b></span>`;
    $('.tlf-sort').value = S.sort;
  }

  function renderBar() {
    const total = S.data?.videos?.length || 0;
    $('.tlf-count').textContent = S.data ? `${S.view.length} из ${total} ${plural(total, 'видео', 'видео', 'видео')}` : '';
    const more = $('.tlf-more');
    const cap = S.src?.kind === 'channel' ? CH_MAX : SEARCH_MAX;
    // если пришло меньше, чем просили, — больше взять негде
    const exhausted = !S.data || total < S.max || S.max >= cap;
    more.hidden = !S.src;
    more.disabled = S.loading || exhausted;
    more.title = exhausted && S.data ? 'Больше видео нет' : '';
    more.querySelector('span').textContent = S.loading && S.data ? 'Загрузка…' : 'Загрузить ещё';
    $('.tlf-csv').disabled = !S.view.length;
    $('.tlf-progress').hidden = !S.loading;
  }

  function card(v) {
    const id = esc(v.id);
    const url = `/watch?v=${encodeURIComponent(v.id)}`;
    const thumb = v.thumb || `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/mqdefault.jpg`;
    const d = dur(v.duration);
    const short = v.duration > 0 && v.duration <= 180;
    const av = v.channelThumb
      ? `<img class="tlf-av" src="${esc(v.channelThumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="tlf-av tlf-av0" aria-hidden="true">${esc(String(v.channelTitle || '?').trim().charAt(0).toUpperCase())}</span>`;
    const chHref = v.channelId ? `/channel/${encodeURIComponent(v.channelId)}` : null;
    const outCls = v.out == null ? '' : v.out >= 3 ? ' hot' : v.out >= 1.5 ? ' up' : '';
    const pills = [
      v.vph != null ? `<span class="tlf-pill" title="Просмотров в час с момента публикации">${fmtV(v.vph)} VPH</span>` : '',
      v.out != null ? `<span class="tlf-pill${outCls}" title="Во сколько раз больше медианы просмотров канала">${fmtX(v.out)}</span>` : '',
      v.ratio != null ? `<span class="tlf-pill${v.ratio >= 1 ? ' up' : ''}" title="Просмотры / подписчики канала">${ic('users', 11)}${v.ratio >= 10 ? Math.round(v.ratio) : v.ratio.toFixed(v.ratio < 0.1 ? 2 : 1)}</span>` : '',
    ].join('');
    const meta = [viewsText(v.views), v.publishedText].filter(Boolean).map(esc).join(' • ');
    return `<article class="tlf-card" role="listitem" data-id="${id}">
      <a class="tlf-thumb" href="${url}" tabindex="-1" aria-hidden="true">
        <img src="${esc(thumb)}" alt="" loading="lazy">
        ${d ? `<span class="tlf-dur${short ? ' tlf-short' : ''}">${d}</span>` : ''}
      </a>
      <div class="tlf-info">
        <a class="tlf-title" href="${url}" title="${esc(v.title)}">${esc(v.title)}</a>
        <div class="tlf-chrow">${av}${chHref ? `<a class="tlf-chname" href="${chHref}" tabindex="-1">${esc(v.channelTitle)}</a>` : `<span class="tlf-chname">${esc(v.channelTitle)}</span>`}
          ${v.subs != null ? `<span class="tlf-subs">${fmt(v.subs)} подп.</span>` : ''}</div>
        <div class="tlf-meta">${meta}</div>
        <div class="tlf-pills">${pills}<span class="tlf-sp"></span>
          <button type="button" class="tlf-an" data-id="${id}" title="Анализ в TubeLens" aria-label="Анализ видео в TubeLens">${ic('chart', 15)}</button></div>
      </div>
    </article>`;
  }

  function stateHtml(icon, title, text, btn) {
    return `<div class="tlf-empty"><span class="tlf-ei">${ic(icon, 30)}</span><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}
      ${btn ? `<button type="button" class="tlf-btn tlf-primary" data-act="${btn[0]}">${esc(btn[1])}</button>` : ''}</div>`;
  }

  function renderGrid() {
    if (!root) return;
    const grid = $('.tlf-grid'), st = $('.tlf-state');
    S.view = S.data ? computeView() : [];
    renderBar();
    let state = '';
    if (!S.src) {
      state = stateHtml('search', 'Введите запрос', 'Найдём видео и посчитаем VPH, множитель к медиане канала и просмотры на подписчика.', ['focus', 'К поиску']);
      grid.innerHTML = '';
    } else if (S.loading && !S.data) {
      state = `<div class="tlf-loading" role="status">${S.src.kind === 'search' ? 'Ищем видео и собираем статистику каналов… обычно 3–6 секунд' : 'Загружаем видео канала…'}</div>`;
      grid.innerHTML = Array.from({ length: 12 }, () => '<div class="tlf-skel" aria-hidden="true"><i></i><b></b><b></b><b></b></div>').join('');
    } else if (S.error && !S.data) {
      state = stateHtml('close', 'Не удалось загрузить видео', S.error, ['retry', 'Повторить']);
      grid.innerHTML = '';
    } else if (S.data && !S.data.videos?.length) {
      state = stateHtml('search', 'Ничего не найдено', 'Попробуйте другой запрос.', null);
      grid.innerHTML = '';
    } else if (S.data && !S.view.length) {
      state = stateHtml('filter', 'Ничего не подошло — ослабьте фильтры', 'Ни одно из загруженных видео не прошло текущие условия. Смените пресет, очистите свои фильтры или загрузите больше видео.', ['clear', 'Сбросить фильтры']);
      grid.innerHTML = '';
    } else {
      grid.innerHTML = S.view.map(card).join('');
    }
    if (S.error && S.data) state = `<div class="tlf-inline-err" role="alert">${esc(S.error)}</div>` + state;
    st.innerHTML = state;
    st.hidden = !state;
    grid.classList.toggle('tlf-dim', S.loading && !!S.data);
  }

  function renderAll() {
    renderSide();
    renderTop();
    renderGrid();
  }

  // ---------- загрузка ----------
  async function load(force = false) {
    const msg = fetchParams();
    if (!msg) { S.data = null; S.error = null; S.loading = false; renderAll(); return; }
    const key = keyOf(msg);
    if (!force && S.cache.has(key)) {
      S.data = S.cache.get(key); S.dataKey = key; S.error = null; S.loading = false;
      renderAll();
      return;
    }
    if (!force && key === S.dataKey && S.data) { renderAll(); return; }
    const req = ++S.req;
    // если меняется сам источник — старые карточки не показываем
    if (S.data && S.data.__src !== srcKey(S.src)) S.data = null;
    S.loading = true; S.error = null;
    renderAll();
    try {
      const data = await send(msg);
      if (req !== S.req) return;
      data.videos = Array.isArray(data?.videos) ? data.videos : [];
      data.__src = srcKey(S.src);
      S.cache.set(key, data);
      if (S.cache.size > 12) S.cache.delete(S.cache.keys().next().value);
      S.data = data; S.dataKey = key;
    } catch (e) {
      if (req !== S.req) return;
      S.error = e.code === 'NO_KEY' ? 'Добавьте ключ YouTube API в настройках TubeLens.' : e.message || 'Неизвестная ошибка';
    } finally {
      if (req === S.req) { S.loading = false; renderAll(); }
    }
  }

  function setSource(src) {
    if (srcKey(src) !== srcKey(S.src)) {
      S.src = src;
      S.max = src.kind === 'channel' ? CH_START : SEARCH_START;
      S.data = null; S.dataKey = '';
      $('.tlf-body').scrollTop = 0;
    }
    load();
  }

  function setPreset(id) {
    const p = presetById(id);
    const before = keyOf(fetchParams());
    S.preset = p.id;
    S.sort = p.sort || 'default';
    if (S.src?.kind === 'search' && keyOf(fetchParams()) !== before) {
      S.max = SEARCH_START;
      $('.tlf-body').scrollTop = 0;
      load();
    } else {
      renderSide(); renderTop(); renderGrid();
    }
  }

  function loadMore() {
    if (!S.src || S.loading) return;
    if (S.src.kind === 'channel') S.max = Math.min(CH_MAX, S.max + CH_STEP);
    else S.max = Math.min(SEARCH_MAX, S.max + SEARCH_STEP);
    load();
  }

  // ---------- CSV ----------
  function csvText(rows) {
    const SEP = ';'; // Excel с русской локалью ждёт «;» и десятичную запятую
    const cell = (x) => {
      if (x == null) return '';
      const s = String(x);
      return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const dec = (n, d = 2) => (n == null || !isFinite(n) ? '' : String(+n.toFixed(d)).replace('.', ','));
    const date = (v) => {
      const t = v.publishedAt ? Date.parse(v.publishedAt) : NaN;
      if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
      if (v.ageHours != null) return new Date(Date.now() - v.ageHours * 3600e3).toISOString().slice(0, 10);
      return v.publishedText || '';
    };
    const head = ['Название', 'URL', 'Канал', 'Просмотры', 'Подписчики', 'VPH', 'Множитель ×', 'Просмотры/подписчики', 'Дата публикации', 'Длительность'];
    const lines = [head.map(cell).join(SEP)];
    for (const v of rows) {
      lines.push([
        v.title, `https://www.youtube.com/watch?v=${v.id}`, v.channelTitle,
        v.views ?? '', v.subs ?? '', dec(v.vph, 1), dec(v.out, 2), dec(v.ratio, 3), date(v), dur(v.duration),
      ].map(cell).join(SEP));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function downloadCsv() {
    if (!S.view.length) return;
    const blob = new Blob([csvText(S.view)], { type: 'text/csv;charset=utf-8' });
    const name = String(S.data?.title || S.src?.q || 'videos').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tubelens_${name}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`CSV: ${S.view.length} ${plural(S.view.length, 'строка', 'строки', 'строк')}`);
  }

  // ---------- открыть / закрыть ----------
  function onDocKey(e) {
    if (S.open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function open() {
    if (!root) build();
    const ps = pageSource();
    S.pageChannel = channelHrefFromPath(location.pathname);
    S.restoreFocus = document.activeElement;
    S.open = true;
    root.hidden = false;
    const de = document.documentElement;
    S.prevOverflow = [de.style.overflow, document.body.style.overflow];
    de.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onDocKey, true);
    document.getElementById('tl-filters-btn')?.setAttribute('aria-expanded', 'true');
    if (ps) setSource(ps);
    else if (S.src) load();
    else renderAll();
    requestAnimationFrame(() => (S.src ? $('.tlf-close') : $('.tlf-q')).focus({ preventScroll: true }));
  }

  function close() {
    if (!S.open) return;
    S.open = false;
    root.hidden = true;
    const [a, b] = S.prevOverflow || ['', ''];
    document.documentElement.style.overflow = a;
    document.body.style.overflow = b;
    window.removeEventListener('keydown', onDocKey, true);
    const btn = document.getElementById('tl-filters-btn');
    btn?.setAttribute('aria-expanded', 'false');
    const f = S.restoreFocus;
    S.restoreFocus = null;
    if (f && f.isConnected && typeof f.focus === 'function') f.focus({ preventScroll: true });
  }

  // ---------- кнопка в шапке ----------
  function ensureButton() {
    const end = document.querySelector('ytd-masthead #end');
    if (!end) return;
    let b = document.getElementById('tl-filters-btn');
    if (b && b.parentElement === end) return;
    if (!b) {
      b = document.createElement('button');
      b.id = 'tl-filters-btn';
      b.type = 'button';
      b.title = 'TubeLens: фильтры видео';
      b.setAttribute('aria-haspopup', 'dialog');
      b.setAttribute('aria-expanded', 'false');
      b.innerHTML = `${ic('filter', 16)}<span>Фильтры</span>`;
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); S.open ? close() : open(); });
    }
    const buttons = [...end.children].find((c) => c.id === 'buttons');
    if (buttons) end.insertBefore(b, buttons);
    else end.prepend(b);
  }

  // Контекст расширения потерян (обновили/отключили расширение) — убираем кнопку и останавливаем таймер
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const onNav = () => {
    ensureButton();
    // при переходе на другую страницу панель закрываем — источник сменился
    if (S.open) close();
  };
  document.addEventListener('yt-navigate-finish', onNav);
  const btnTimer = setInterval(() => {
    if (alive()) return ensureButton();
    if (S.open) return; // открытую панель не выдёргиваем из-под пользователя — уберём после закрытия
    clearInterval(btnTimer);
    document.removeEventListener('yt-navigate-finish', onNav);
    document.getElementById('tl-filters-btn')?.remove();
    root?.remove();
  }, 1500);
  ensureButton();
})();
