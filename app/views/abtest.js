// A/B-превью: как превью и заголовок смотрятся среди настоящих конкурентов до публикации.
// Картинки читаются локально (FileReader → data URL) и никуда не отправляются.
import { $, $$, esc, icon, pageHead, toast, dur, timeAgo } from '../ui.js';
import { search, channelPage } from '../../lib/innertube.js';
import { getSettings, getData, setData } from '../../lib/storage.js';

const KEY = 'abtest:last';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR = 1024 * 1024;
const TYPES = /^image\/(png|jpeg|webp|gif)$/;
const VARS = ['A', 'B', 'C'];
const LAYOUTS = [['home', 'Главная (сетка)'], ['search', 'Поиск (список)'], ['related', 'Рядом с видео'], ['mobile', 'Мобильный']];
const COUNTS = { home: 12, search: 8, related: 10, mobile: 6 };
const POS = [['1', '1-я'], ['2', '2-я'], ['3', '3-я'], ['5', '5-я'], ['rand', 'Случайная']];
const TEST_MS = 5000;

/* ---------- текст: склонения, форматы как в русском интерфейсе YouTube ---------- */
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const short = (x) => (x < 10 ? x.toFixed(1).replace(/\.0$/, '').replace('.', ',') : String(Math.floor(x)));
function ruViews(n) {
  if (!Number.isFinite(n) || n <= 0) return 'Нет просмотров';
  if (n < 1e3) return `${n} ${plural(n, 'просмотр', 'просмотра', 'просмотров')}`;
  if (n < 1e6) return `${short(n / 1e3)} тыс. просмотров`;
  if (n < 1e9) return `${short(n / 1e6)} млн просмотров`;
  return `${short(n / 1e9)} млрд просмотров`;
}
const AGO = {
  second: ['секунду', 'секунды', 'секунд'], minute: ['минуту', 'минуты', 'минут'], hour: ['час', 'часа', 'часов'],
  day: ['день', 'дня', 'дней'], week: ['неделю', 'недели', 'недель'], month: ['месяц', 'месяца', 'месяцев'], year: ['год', 'года', 'лет'],
};
function ruAgo(text, iso) {
  const m = /(\d+)\s*(second|minute|hour|day|week|month|year)/i.exec(text || '');
  if (m) { const n = +m[1]; return `${n} ${plural(n, ...AGO[m[2].toLowerCase()])} назад`; }
  return iso ? timeAgo(iso) : '';
}

const STOP = new Set('и в во на по с со к ко о об от до из за для не ни а но как что это мой моя мои мы вы ты он она они the a an of to in on for and with how what why is are my your vs'.split(' '));
const words = (s) => (String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
function guessQuery(title) {
  return words(title).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 3).join(' ');
}
const EMOJI = /\p{Extended_Pictographic}/gu;

/* ---------- анализ картинки на canvas ---------- */
function loadImg(src, cors) {
  return new Promise((res, rej) => {
    const im = new Image();
    if (cors) im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image'));
    im.src = src;
  });
}
const cdist = (a, b) => { // «redmean» — грубое приближение воспринимаемой разницы цветов
  const r = (a.r + b.r) / 2, dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
};
async function analyze(src, cors) {
  const im = await loadImg(src, cors);
  const W = 64, H = 36, nw = im.naturalWidth, nh = im.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  // как в ленте: обрезка «cover» до 16:9
  let sx = 0, sy = 0, sw = nw, sh = nh;
  if (nw / nh > 16 / 9) { sw = nh * 16 / 9; sx = (nw - sw) / 2; } else { sh = nw * 9 / 16; sy = (nh - sh) / 2; }
  x.drawImage(im, sx, sy, sw, sh, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data; // бросит исключение, если картинка без CORS
  const n = W * H, buckets = new Map();
  let sum = 0, sum2 = 0, sat = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += y; sum2 += y * y;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx ? (mx - mn) / mx : 0;
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = buckets.get(k) || { r: 0, g: 0, b: 0, n: 0 };
    e.r += r; e.g += g; e.b += b; e.n++;
    buckets.set(k, e);
  }
  const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  // доминирующие цвета: крупные корзины, близкие сливаем
  const pal = [];
  for (const e of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    const col = { r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n };
    const near = pal.find((p) => cdist(p, col) < 70);
    if (near) { const t = near.n + col.n; for (const ch of 'rgb') near[ch] = (near[ch] * near.n + col[ch] * col.n) / t; near.n = t; } else if (pal.length < 8) pal.push(col);
  }
  pal.sort((a, b) => b.n - a.n);
  const palette = pal.slice(0, 4).map((p) => ({ r: Math.round(p.r), g: Math.round(p.g), b: Math.round(p.b), share: p.n / n }));
  return { lum: mean / 2.55, contrast: sd / 2.55, sat: (sat / n) * 100, palette, w: nw, h: nh };
}
// насколько палитры отличаются (0 — одинаковые)
function palDist(a, b) {
  const one = (p, q) => {
    let s = 0, w = 0;
    for (const c of p.palette) { s += c.share * Math.min(...q.palette.map((o) => cdist(c, o))); w += c.share; }
    return w ? s / w : 0;
  };
  return (one(a, b) + one(b, a)) / 2 + Math.abs(a.lum - b.lum) * 1.5;
}
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

/* ---------- состояние ---------- */
const blankVar = (id) => ({ id, thumb: '', title: '', w: 0, h: 0, size: 0 });
function restore(saved) {
  const d = {
    variants: VARS.map(blankVar), channel: { name: '', avatar: '', id: '' },
    viewsText: '1,2 тыс. просмотров', agoText: '2 часа назад', duration: '10:24',
    query: '', queryAuto: true, ctx: { label: '', source: '', videos: [] },
    layout: 'home', theme: 'dark', pos: '1', rand: Math.random(), active: 'A', highlight: false, order: [], tests: {},
  };
  if (!saved || typeof saved !== 'object') return d;
  const o = { ...d, ...saved };
  o.variants = VARS.map((id, i) => ({ ...blankVar(id), ...(saved.variants?.[i] || {}), id }));
  o.channel = { ...d.channel, ...(saved.channel || {}) };
  o.ctx = { ...d.ctx, ...(saved.ctx || {}) };
  if (!Array.isArray(o.ctx.videos)) o.ctx.videos = [];
  if (!LAYOUTS.some(([k]) => k === o.layout)) o.layout = 'home';
  if (!['dark', 'light'].includes(o.theme)) o.theme = 'dark';
  if (!POS.some(([k]) => k === o.pos)) o.pos = '1';
  if (!VARS.includes(o.active)) o.active = 'A';
  if (!Array.isArray(o.order)) o.order = [];
  if (!o.tests || typeof o.tests !== 'object') o.tests = {};
  return o;
}
const hasContent = (v) => !!(v.thumb || v.title.trim());

export async function render(root, params, isStale = () => false) {
  const [settings, saved] = await Promise.all([getSettings(), getData(KEY, null)]);
  if (isStale()) return;
  const st = restore(saved);
  const myId = settings.myChannel || '';
  const varStats = new Map();   // src → результат analyze() (или null)
  const compStats = new Map();  // id видео → результат analyze() (или null)
  let compRun = 0;
  let editVar = st.active;      // куда вставлять картинку из буфера
  let test = null;              // идущий «Тест 5 секунд»

  root.innerHTML = `<div class="v-abtest">
    ${pageHead('A/B-превью', 'Как ваше превью и заголовок смотрятся среди настоящих конкурентов — до публикации. Картинки остаются в браузере и никуда не отправляются.')}
    <div class="ab-vars" id="abVars">${VARS.map((id) => `<section class="card ab-var" data-v="${id}" aria-label="Вариант ${id}"></section>`).join('')}</div>

    <div class="card ab-ctx">
      <div class="ab-ctx-col">
        <h3>Ваш канал</h3>
        <div class="ab-chan">
          <button type="button" class="ab-av-btn" id="abAvBtn" title="Загрузить аватар" aria-label="Загрузить аватар"></button>
          <input type="file" class="ab-file" id="abAvFile" accept="image/png,image/jpeg,image/webp,image/gif" tabindex="-1" aria-hidden="true">
          <div class="grow"><label for="abChan" class="ab-l0">Название канала</label><input id="abChan" autocomplete="off" placeholder="Мой канал"></div>
        </div>
        <div class="ab-meta3">
          <div><label for="abViews">Просмотры</label><input id="abViews" autocomplete="off"></div>
          <div><label for="abAgo">Опубликовано</label><input id="abAgo" autocomplete="off"></div>
          <div><label for="abDur">Длительность</label><input id="abDur" autocomplete="off" class="mono"></div>
        </div>
      </div>
      <div class="ab-ctx-col">
        <h3>Видео вокруг</h3>
        <form class="ab-q" id="abQForm" role="search">
          <div class="search grow">${icon('search', 16)}<input id="abQ" autocomplete="off" aria-label="Запрос для подбора конкурентов" placeholder="Запрос, по которому ищут ваше видео"></div>
          <button class="btn">${icon('users', 15)} Найти конкурентов</button>
        </form>
        <div class="row ab-q2">
          <button type="button" class="btn ghost sm" id="abMine" ${myId ? '' : 'disabled title="Укажите свой канал в настройках"'}>${icon('play', 14)} Мои последние видео</button>
          <span class="muted small" id="abCtxInfo"></span>
        </div>
        ${myId ? '' : `<p class="muted small ab-tip">Чтобы подставлять название, аватар и свои видео, укажите канал в <a href="#/settings">настройках</a>.</p>`}
      </div>
    </div>

    <div class="section-head"><h2>Предпросмотр</h2></div>
    <div class="ab-bar">
      <div class="seg ab-lay" role="group" aria-label="Где показать">${LAYOUTS.map(([k, l]) => `<button type="button" data-lay="${k}">${l}</button>`).join('')}</div>
      <div class="seg ab-yt" role="group" aria-label="Тема страницы">${[['dark', 'Тёмный YouTube'], ['light', 'Светлый YouTube']].map(([k, l]) => `<button type="button" data-yt="${k}">${l}</button>`).join('')}</div>
    </div>
    <div class="ab-bar">
      <div class="seg ab-vsw" role="group" aria-label="Показываемый вариант (клавиши 1, 2, 3)">${VARS.map((id, i) => `<button type="button" data-show="${id}">${id}<kbd>${i + 1}</kbd></button>`).join('')}</div>
      <div class="ab-pos"><label for="abPos">Позиция</label><select id="abPos">${POS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <button type="button" class="btn ghost sm" id="abShuffle">${icon('refresh', 14)} Перемешать</button>
      <button type="button" class="btn ghost sm" id="abTest">${icon('clock', 14)} Тест 5 секунд</button>
      <label class="check ab-hl"><input type="checkbox" id="abHl"> Подсветить мой вариант</label>
    </div>
    <div class="ab-stage" id="abStage">
      <div class="ytp-frame" id="abFrame"></div>
      <div class="ab-overlay" id="abOverlay" hidden></div>
    </div>

    <div class="section-head"><h2>Объективные подсказки</h2></div>
    <div id="abHints"></div>
    <div class="ab-measure" id="abMeasure" aria-hidden="true"></div>
  </div>`;

  const v = (id) => st.variants.find((x) => x.id === id);
  const curVar = () => { const a = v(st.active); return a && hasContent(a) ? a : st.variants.find(hasContent) || null; };

  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => setData(KEY, st).catch((e) => toast('Не удалось сохранить: ' + e.message, true)), 400); };

  /* ---------- редакторы вариантов ---------- */
  const measure = $('#abMeasure', root);
  // сколько символов заголовка влезает в 2 строки при заданном шрифте и ширине
  // (по символам, а не UTF-16: эмодзи не режутся пополам)
  function fit(chars, font, lh, width) {
    Object.assign(measure.style, { font, lineHeight: lh + 'px', width: width + 'px' });
    const ok = (s) => { measure.textContent = s; return measure.offsetHeight <= lh * 2 + 1; };
    if (ok(chars.join(''))) return chars.length;
    let lo = 0, hi = chars.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ok(chars.slice(0, m).join('').trimEnd() + '…')) lo = m; else hi = m - 1; }
    return lo;
  }
  function truncHtml(title) {
    const t = title.trim();
    if (!t) return '';
    const ch = [...t];
    const spots = [['Главная', '500 16px Roboto, Arial, sans-serif', 22, 270], ['Рядом с видео', '500 14px Roboto, Arial, sans-serif', 20, 200], ['Телефон', '500 14px Roboto, Arial, sans-serif', 20, 290]];
    return spots.map(([name, font, lh, w]) => {
      const n = fit(ch, font, lh, w);
      if (n >= ch.length) return `<li class="good">${icon('check', 13)}<span><b>${name}:</b> влезает целиком</span></li>`;
      return `<li class="bad">${icon('x', 13)}<span><b>${name}:</b> «${esc(ch.slice(0, n).join('').trimEnd())}<i>…</i>» — видно ${n} из ${ch.length}</span></li>`;
    }).join('');
  }
  function countHtml(t) {
    const n = [...t].length;
    const cls = n > 70 ? 'bad' : n > 60 ? 'mid' : '';
    return `<span class="mono ${cls}">${n}/100</span>${n > 70 ? `<span class="bad">${icon('alert', 13)} длиннее 70 — обрежется</span>` : ''}`;
  }
  function imgInfo(x) {
    if (!x.thumb) return '';
    const ar = x.w && x.h ? x.w / x.h : 16 / 9;
    const warn = [];
    if (Math.abs(ar - 16 / 9) > 0.03) warn.push('не 16:9 — края обрежутся');
    if (x.w && x.w < 1280) warn.push('меньше 1280×720');
    return `<span class="mono">${x.w}×${x.h}</span>${x.size ? ` · <span class="mono">${Math.round(x.size / 1024)} КБ</span>` : ''}${warn.length ? ` · <span class="mid">${warn.join(', ')}</span>` : ''}`;
  }
  function renderVar(id) {
    const x = v(id), el = $(`.ab-var[data-v="${id}"]`, root);
    el.innerHTML = `<div class="ab-var-head"><span class="ab-tag">${id}</span><h3>Вариант ${id}</h3>
        ${hasContent(x) ? `<button type="button" class="btn ghost sm" data-clear title="Очистить вариант">${icon('trash', 14)}</button>` : ''}</div>
      <div class="ab-drop ${x.thumb ? 'has' : ''}" tabindex="0" role="button" aria-label="Превью варианта ${id}: выбрать файл, перетащить или вставить из буфера">
        ${x.thumb ? `<img src="${esc(x.thumb)}" alt="">` : `<div class="ab-drop-ph">${icon('image', 22)}<b>Перетащите картинку</b><span>или нажмите, чтобы выбрать · Ctrl+V — вставить</span><span class="mono">PNG, JPG, WebP, GIF · до 2 МБ</span></div>`}
        <input type="file" class="ab-file" data-file accept="image/png,image/jpeg,image/webp,image/gif" tabindex="-1" aria-hidden="true">
      </div>
      ${x.thumb ? `<div class="ab-imginfo small muted"><span>${imgInfo(x)}</span><span class="ab-mini" title="Так превью видно в колонке «Рядом с видео»"><img src="${esc(x.thumb)}" alt=""></span></div>` : ''}
      <label for="abT${id}">Заголовок</label>
      <textarea id="abT${id}" data-title rows="2" maxlength="100" placeholder="Заголовок варианта ${id}">${esc(x.title)}</textarea>
      <div class="ab-count small" data-count>${countHtml(x.title)}</div>
      <ul class="ab-trunc small" data-trunc>${truncHtml(x.title)}</ul>`;
  }

  function readImage(file, maxBytes = MAX_BYTES) {
    return new Promise((res, rej) => {
      if (!file || !TYPES.test(file.type)) return rej(new Error('Нужна картинка PNG, JPG, WebP или GIF'));
      if (file.size > maxBytes) return rej(new Error(`Файл ${(file.size / 1048576).toFixed(1)} МБ — больше ${maxBytes / 1048576} МБ`));
      const fr = new FileReader();
      fr.onerror = () => rej(new Error('Не удалось прочитать файл'));
      fr.onload = async () => {
        try { const im = await loadImg(fr.result); res({ url: fr.result, w: im.naturalWidth, h: im.naturalHeight, size: file.size }); } catch { rej(new Error('Картинка повреждена')); }
      };
      fr.readAsDataURL(file);
    });
  }
  async function setThumb(id, file) {
    try {
      const r = await readImage(file);
      Object.assign(v(id), { thumb: r.url, w: r.w, h: r.h, size: r.size });
      if (!hasContent(v(st.active)) || st.active === id) st.active = id;
      renderVar(id); renderPreview(); renderHints(); save();
      toast(`Превью варианта ${id} загружено`);
    } catch (e) { toast(e.message, true); }
  }

  /* ---------- контекст: канал и конкуренты ---------- */
  const avBtn = $('#abAvBtn', root);
  const avatarHtml = (url, name, size) => url
    ? `<img class="ytp-av" style="width:${size}px;height:${size}px" src="${esc(url)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="ytp-av ytp-av-l" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;--h:${[...String(name || '?')].reduce((a, c) => (a * 31 + c.codePointAt(0)) % 360, 7)}">${esc([...String(name || '?').trim()][0] || '?').toUpperCase()}</span>`;
  const paintAvatar = () => { avBtn.innerHTML = avatarHtml(st.channel.avatar, st.channel.name || 'М', 44); };

  function fillCtxInputs() {
    $('#abChan', root).value = st.channel.name;
    $('#abViews', root).value = st.viewsText;
    $('#abAgo', root).value = st.agoText;
    $('#abDur', root).value = st.duration;
    $('#abQ', root).value = st.query;
    syncQueryPh();
    paintAvatar();
    ctxInfo();
  }
  const syncQueryPh = () => {
    const g = guessQuery(curVar()?.title || st.variants.find((x) => x.title)?.title || '');
    if (st.queryAuto && g && !st.query) $('#abQ', root).placeholder = g;
  };
  const ctxInfo = (msg) => {
    $('#abCtxInfo', root).innerHTML = msg ?? (st.ctx.videos.length ? `${st.ctx.videos.length} видео · ${esc(st.ctx.label)}` : 'Конкуренты ещё не загружены');
  };

  async function loadCtx(kind) {
    let q = $('#abQ', root).value.trim();
    if (kind === 'search' && !q) {
      q = guessQuery(curVar()?.title || '');
      if (!q) { toast('Введите запрос или заголовок варианта', true); $('#abQ', root).focus(); return; }
      $('#abQ', root).value = q;
    }
    const btns = $$('#abQForm .btn, #abMine', root);
    btns.forEach((b) => (b.disabled = true));
    ctxInfo(`<span class="ab-spin"></span>${kind === 'mine' ? 'Загружаю ваши видео…' : 'Ищу видео по запросу…'}`);
    try {
      let vids, label;
      if (kind === 'mine') {
        const r = await channelPage(myId, 12);
        vids = r.videos; label = 'мои последние видео';
        if (r.channel?.title && !st.channel.name) { st.channel.name = r.channel.title; $('#abChan', root).value = r.channel.title; }
        if (r.channel?.thumb && !st.channel.avatar) st.channel.avatar = r.channel.thumb;
        paintAvatar();
      } else {
        vids = await search(q, { max: 20 });
        label = `по запросу «${q}»`;
        st.query = q; st.queryAuto = false;
      }
      if (!root.isConnected) return;
      vids = (vids || []).filter((x) => x.id && x.title && !x.live).slice(0, 20);
      if (!vids.length) throw new Error('Ничего не нашлось — попробуйте другой запрос');
      st.ctx = {
        source: kind, label,
        videos: vids.map((x) => ({ id: x.id, title: x.title, channelTitle: x.channelTitle || '', views: x.views || 0, publishedText: x.publishedText || '', publishedAt: x.publishedAt || '', duration: x.duration || 0, thumb: x.thumb, description: (x.description || '').slice(0, 220) })),
      };
      st.order = st.ctx.videos.map((_, i) => i);
      compStats.clear();
      ctxInfo();
      renderPreview(); analyzeComps(); save();
    } catch (e) {
      console.error(e);
      ctxInfo(`<span class="bad">${esc(e.message || String(e))}</span>`);
    } finally {
      btns.forEach((b) => (b.disabled = b.id === 'abMine' && !myId));
    }
  }

  async function analyzeComps() {
    const run = ++compRun;
    const todo = st.ctx.videos.filter((x) => !compStats.has(x.id));
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const x = todo[i++];
        let r = null;
        try { r = await analyze(x.thumb, true); } catch { /* без CORS или не загрузилось */ }
        if (run !== compRun) return;
        compStats.set(x.id, r);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (run === compRun && root.isConnected) renderHints();
  }

  /* ---------- предпросмотр ---------- */
  const slotFor = (n) => (test ? test.slot : st.pos === 'rand' ? Math.floor(st.rand * n) : Math.min(+st.pos - 1, n - 1));
  const mineItem = (x) => ({ mine: true, vid: x.id, title: x.title.trim(), thumb: x.thumb, channel: st.channel.name || 'Мой канал', avatar: st.channel.avatar, views: st.viewsText, ago: st.agoText, dur: st.duration, desc: '' });
  const compItem = (c) => ({
    title: c.title, thumb: c.thumb, channel: c.channelTitle || (st.ctx.source === 'mine' ? st.channel.name : ''),
    avatar: st.ctx.source === 'mine' ? st.channel.avatar : '', views: ruViews(c.views), ago: ruAgo(c.publishedText, c.publishedAt),
    dur: c.duration ? dur(c.duration) : '', desc: c.description || '',
  });
  function feed() {
    const n = COUNTS[st.layout], vids = st.ctx.videos;
    let order = st.order.filter((i) => i < vids.length);
    if (order.length !== vids.length) order = vids.map((_, i) => i);
    const items = order.slice(0, n - 1).map((i) => compItem(vids[i]));
    while (items.length < n - 1) items.push({ ph: true });
    const x = test ? v(test.id) : curVar();
    if (x) items.splice(Math.max(0, Math.min(slotFor(n), items.length)), 0, mineItem(x));
    else items.push({ ph: true });
    return items;
  }

  const thumbHtml = (it) => `<div class="ytp-th">${it.thumb ? `<img src="${esc(it.thumb)}" alt="" referrerpolicy="no-referrer">` : '<span class="ytp-th-none">Нет превью</span>'}${it.dur ? `<span class="ytp-dur">${esc(it.dur)}</span>` : ''}</div>`;
  const titleHtml = (it, tag = 'h3') => `<${tag} class="ytp-t" title="${esc(it.title)}">${esc(it.title) || '<span class="ytp-empty">Без заголовка</span>'}</${tag}>`;
  const dot = '<span class="ytp-dot">•</span>';
  const itemCls = (it) => `ytp-item${it.mine ? ' is-mine' : ''}${it.mine && st.highlight ? ' hl' : ''}`;
  const phHtml = () => `<div class="ytp-item ytp-ph"><div class="ytp-th"></div><div class="ytp-ph-lines"><i></i><i></i><i></i></div></div>`;
  const kebab = '<span class="ytp-kebab" aria-hidden="true"><i></i><i></i><i></i></span>';

  const CARD = {
    home: (it) => `<div class="${itemCls(it)}">${thumbHtml(it)}<div class="ytp-info">${avatarHtml(it.avatar, it.channel, 36)}<div class="ytp-txt">${titleHtml(it)}
      <div class="ytp-meta"><div>${esc(it.channel)}</div><div>${esc(it.views)}${it.ago ? dot + esc(it.ago) : ''}</div></div></div>${kebab}</div></div>`,
    search: (it) => `<div class="${itemCls(it)}">${thumbHtml(it)}<div class="ytp-txt">${titleHtml(it)}
      <div class="ytp-meta">${esc(it.views)}${it.ago ? dot + esc(it.ago) : ''}</div>
      <div class="ytp-chan">${avatarHtml(it.avatar, it.channel, 24)}<span>${esc(it.channel)}</span></div>
      ${it.desc ? `<div class="ytp-desc">${esc(it.desc)}</div>` : ''}</div>${kebab}</div>`,
    related: (it) => `<div class="${itemCls(it)}">${thumbHtml(it)}<div class="ytp-txt">${titleHtml(it)}
      <div class="ytp-meta"><div>${esc(it.channel)}</div><div>${esc(it.views)}${it.ago ? dot + esc(it.ago) : ''}</div></div></div></div>`,
    mobile: (it) => `<div class="${itemCls(it)}">${thumbHtml(it)}<div class="ytp-info">${avatarHtml(it.avatar, it.channel, 36)}<div class="ytp-txt">${titleHtml(it)}
      <div class="ytp-meta">${esc(it.channel)}${dot}${esc(it.views)}${it.ago ? dot + esc(it.ago) : ''}</div></div>${kebab}</div></div>`,
  };

  function renderPreview() {
    const fr = $('#abFrame', root);
    fr.dataset.yt = st.theme;
    fr.dataset.layout = st.layout;
    const items = feed().map((it) => (it.ph ? phHtml() : CARD[st.layout](it))).join('');
    const q = st.query || $('#abQ', root)?.value || '';
    const top = `<div class="ytp-top"><span class="ytp-burger" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="ytp-sbox"><span class="ytp-sq">${esc(st.layout === 'search' ? q || 'Поиск' : 'Поиск')}</span><span class="ytp-sbtn">${icon('search', 16)}</span></span>
      ${avatarHtml(st.channel.avatar, st.channel.name || 'М', 30)}</div>`;
    let body;
    if (st.layout === 'home') {
      const chips = ['Все', ...(q ? [q] : []), 'Недавно опубликованные', 'Новое для вас'];
      body = `${top}<div class="ytp-chips">${chips.map((c, i) => `<span class="${i ? '' : 'on'}">${esc(c)}</span>`).join('')}</div><div class="ytp-grid">${items}</div>`;
    } else if (st.layout === 'search') {
      body = `${top}<div class="ytp-list">${items}</div>`;
    } else if (st.layout === 'related') {
      body = `${top}<div class="ytp-watch"><div class="ytp-player-col"><div class="ytp-player"><span class="ytp-play" aria-hidden="true"></span></div>
          <div class="ytp-ph-lines ytp-watch-lines"><i></i><i></i></div></div><div class="ytp-rel">${items}</div></div>`;
    } else {
      body = `<div class="ytp-phone"><div class="ytp-top ytp-top-m"><span class="ytp-burger" aria-hidden="true"><i></i><i></i><i></i></span><span class="spacer"></span>${icon('search', 18)}${avatarHtml(st.channel.avatar, st.channel.name || 'М', 26)}</div>
        <div class="ytp-mlist">${items}</div></div>`;
    }
    fr.innerHTML = body;
    syncControls();
  }

  function syncControls() {
    $$('[data-lay]', root).forEach((b) => { b.classList.toggle('on', b.dataset.lay === st.layout); b.setAttribute('aria-pressed', b.dataset.lay === st.layout); });
    $$('[data-yt]', root).forEach((b) => { b.classList.toggle('on', b.dataset.yt === st.theme); b.setAttribute('aria-pressed', b.dataset.yt === st.theme); });
    const cur = curVar()?.id;
    $$('[data-show]', root).forEach((b) => {
      const ok = hasContent(v(b.dataset.show));
      b.disabled = !ok;
      b.classList.toggle('on', b.dataset.show === cur);
      b.setAttribute('aria-pressed', b.dataset.show === cur);
    });
    $('#abPos', root).value = st.pos;
    $('#abHl', root).checked = st.highlight;
  }

  function shuffle() {
    const o = st.ctx.videos.map((_, i) => i);
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    st.order = o;
    st.rand = Math.random();
  }

  /* ---------- подсказки ---------- */
  const hrow = (cls, label, val, note) => `<li class="ab-h ${cls}">${icon(cls === 'good' ? 'check' : cls === 'bad' ? 'alert' : 'zap', 14)}<span class="ab-h-l">${label}</span><b class="ab-h-v">${val}</b>${note ? `<small>${note}</small>` : ''}</li>`;
  function titleRows(x) {
    const t = x.title.trim(), n = [...t].length, out = [];
    out.push(n === 0 ? hrow('bad', 'Длина заголовка', '0', 'Заголовок не задан')
      : hrow(n <= 60 ? 'good' : n <= 70 ? 'mid' : 'bad', 'Длина заголовка', `${n} симв.`, n <= 60 ? 'Читается целиком почти везде' : n <= 70 ? 'На грани: в колонке «Рядом» и на телефоне хвост обрежется' : 'Длиннее 70 — конец заголовка не увидят'));
    if (!t) return out;
    const ws = t.match(/[\p{L}\p{N}]+/gu) || [];
    const caps = ws.filter((w) => [...w].length >= 2 && /\p{L}/u.test(w) && w === w.toUpperCase() && w !== w.toLowerCase());
    out.push(hrow(caps.length > 2 ? 'bad' : caps.length ? 'mid' : 'good', 'Слова КАПСОМ', String(caps.length), caps.length > 2 ? `Много: ${esc(caps.slice(0, 4).join(', '))} — выглядит как кликбейт` : caps.length ? `${esc(caps.join(', '))} — один акцент допустим` : 'Нет'));
    const em = (t.match(EMOJI) || []).length;
    out.push(hrow(em > 2 ? 'mid' : 'good', 'Эмодзи', String(em), em > 2 ? 'Больше двух отвлекает от смысла' : em ? 'В меру' : 'Нет'));
    const kw = words(st.query || $('#abQ', root)?.value || '').join(' ');
    if (!kw) out.push(hrow('mid', 'Ключевое слово', '—', 'Укажите запрос в блоке «Видео вокруг»'));
    else {
      const tw = words(t).join(' ');
      const all = words(kw).every((w) => tw.includes(w));
      const idx = tw.indexOf(kw);
      out.push(idx === 0 ? hrow('good', 'Ключевое слово', 'в начале', `Заголовок начинается с «${esc(kw)}»`)
        : idx > 0 ? hrow('mid', 'Ключевое слово', 'не в начале', `«${esc(kw)}» лучше поставить ближе к началу`)
        : all ? hrow('mid', 'Ключевое слово', 'вразброс', 'Все слова запроса есть, но не подряд')
        : hrow('bad', 'Ключевое слово', 'нет', `В заголовке нет «${esc(kw)}»`));
    }
    return out;
  }
  function compBaseline() {
    const list = st.ctx.videos.map((x) => compStats.get(x.id)).filter(Boolean);
    if (list.length < 4) return null;
    let s = 0, k = 0;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { s += palDist(list[i], list[j]); k++; }
    return { list, base: s / k };
  }
  function imageRows(x, cb) {
    if (!x.thumb) return [hrow('bad', 'Превью', 'нет', 'Загрузите картинку, чтобы оценить яркость и цвета')];
    const s = varStats.get(x.thumb);
    if (s === undefined) return [`<li class="ab-h"><span class="ab-spin"></span><span class="ab-h-l">Анализ превью…</span></li>`];
    if (s === null) return [hrow('mid', 'Превью', '—', 'Не удалось проанализировать картинку')];
    const out = [];
    const L = Math.round(s.lum), C = Math.round(s.contrast);
    out.push(hrow(L < 25 ? 'bad' : L < 35 || L > 85 ? 'mid' : 'good', 'Яркость', `${L}%`, L < 25 ? 'Очень тёмное — потеряется в тёмной теме' : L < 35 ? 'Темновато — проверьте в тёмной теме' : L > 85 ? 'Очень светлое — сольётся со светлой темой' : 'Нормальная'));
    out.push(hrow(C < 14 ? 'bad' : C < 20 ? 'mid' : 'good', 'Контраст', `${C}%`, C < 14 ? 'Низкий — превью «плоское», в маленьком размере читается плохо' : C < 20 ? 'Средний — можно добавить контраста' : 'Хороший'));
    out.push(hrow(s.sat < 18 ? 'mid' : 'good', 'Насыщенность', `${Math.round(s.sat)}%`, s.sat < 18 ? 'Блёклые цвета — сложнее зацепить взгляд' : 'Нормальная'));
    const sw = `<span class="ab-sw">${s.palette.map((c) => `<i style="background:${hex(c)};flex:${Math.max(0.15, c.share).toFixed(2)}" title="${hex(c)} · ${Math.round(c.share * 100)}%"></i>`).join('')}</span>`;
    if (!cb) out.push(hrow('mid', 'Цвета', sw, st.ctx.videos.length ? 'Цвета конкурентов ещё анализируются или недоступны' : 'Загрузите конкурентов, чтобы сравнить'));
    else {
      const d = st.ctx.videos.map((c) => compStats.get(c.id)).filter(Boolean).reduce((a, c) => a + palDist(s, c), 0) / cb.list.length;
      const r = d / cb.base;
      out.push(hrow(r >= 1.15 ? 'good' : r >= 0.9 ? 'mid' : 'bad', 'Цвета', sw, `${r >= 1.15 ? 'Выделяется среди конкурентов' : r >= 0.9 ? 'На уровне конкурентов — не выделяется' : 'Сливается с конкурентами'} (×${r.toFixed(2)} к их разнице между собой)`));
    }
    return out;
  }
  function compPalette(cb) {
    if (!cb) return '';
    const all = cb.list.flatMap((s) => s.palette.map((c) => ({ ...c, share: c.share / cb.list.length })));
    const merged = [];
    for (const c of all.sort((a, b) => b.share - a.share)) {
      const m = merged.find((p) => cdist(p, c) < 60);
      if (m) m.share += c.share; else merged.push({ ...c });
    }
    const top = merged.sort((a, b) => b.share - a.share).slice(0, 8);
    const lum = cb.list.reduce((a, s) => a + s.lum, 0) / cb.list.length;
    const con = cb.list.reduce((a, s) => a + s.contrast, 0) / cb.list.length;
    return `<div class="notice ab-comp">${icon('palette', 16)}<div><b>Типичные цвета конкурентов</b> <span class="ab-sw ab-sw-wide">${top.map((c) => `<i style="background:${hex(c)};flex:${c.share.toFixed(3)}" title="${hex(c)}"></i>`).join('')}</span>
      <div>Средняя яркость <span class="mono">${Math.round(lum)}%</span>, контраст <span class="mono">${Math.round(con)}%</span> · проанализировано ${cb.list.length} из ${st.ctx.videos.length} превью. Сделайте превью заметно отличающимся по цвету или яркости.</div></div></div>`;
  }
  function renderHints() {
    const el = $('#abHints', root);
    const list = st.variants.filter(hasContent);
    if (!list.length) { el.innerHTML = `<div class="empty">Загрузите превью или введите заголовок хотя бы одного варианта — здесь появятся подсказки.</div>`; return; }
    const pending = list.filter((x) => x.thumb && !varStats.has(x.thumb));
    const cb = compBaseline();
    const unavailable = st.ctx.videos.length && !cb && st.ctx.videos.every((x) => compStats.has(x.id));
    el.innerHTML = `${compPalette(cb)}${unavailable ? `<div class="notice">${icon('alert', 16)}<div>Цвета превью конкурентов недоступны для анализа — сравнение по цветам пропущено.</div></div>` : ''}
      <div class="ab-hints">${list.map((x) => {
        const t = st.tests[x.id];
        return `<div class="card ab-hcard"><div class="ab-var-head"><span class="ab-tag">${x.id}</span><h3>Вариант ${x.id}</h3>${t?.n ? `<span class="badge ${t.hit / t.n >= 0.5 ? 'up' : ''}" title="Тест 5 секунд: сколько раз вариант запомнился">тест ${t.hit}/${t.n}</span>` : ''}</div>
        <ul class="ab-hlist">${[...titleRows(x), ...imageRows(x, cb)].join('')}</ul></div>`;
      }).join('')}</div>`;
    for (const x of pending) {
      const src = x.thumb;
      varStats.set(src, undefined);
      analyze(src, false).then((r) => varStats.set(src, r), () => varStats.set(src, null)).then(() => { if (root.isConnected) renderHints(); });
    }
  }

  /* ---------- «Тест 5 секунд» ---------- */
  const overlay = $('#abOverlay', root), stage = $('#abStage', root);
  function closeTest() {
    if (test?.timer) clearTimeout(test.timer);
    test = null;
    overlay.hidden = true;
    overlay.innerHTML = '';
    stage.classList.remove('running', 'hidden-feed');
    renderPreview();
  }
  function startTest() {
    const x = curVar();
    if (!x) return toast('Заполните хотя бы один вариант', true);
    if (st.ctx.videos.length < 4) return toast('Сначала загрузите конкурентов', true);
    shuffle();
    test = { id: x.id, slot: Math.floor(Math.random() * Math.min(COUNTS[st.layout], 6)), timer: 0 };
    stage.classList.add('hidden-feed');
    overlay.hidden = false;
    overlay.innerHTML = `<div class="ab-ov-box"><h3>Тест 5 секунд</h3>
      <p>Покажем ленту на 5 секунд, как её видит зритель. Не ищите свой вариант — просто посмотрите. Потом спросим, что запомнилось.</p>
      <div class="row"><button type="button" class="btn" data-go>${icon('play', 15)} Начать</button><button type="button" class="btn ghost" data-close>Отмена</button></div></div>`;
    $('[data-go]', overlay).focus();
    renderPreview();
  }
  function runTest() {
    overlay.hidden = true;
    stage.classList.remove('hidden-feed');
    stage.classList.add('running');
    renderPreview();
    test.timer = setTimeout(askTest, TEST_MS);
  }
  function askTest() {
    if (!test || !root.isConnected) return;
    stage.classList.remove('running');
    stage.classList.add('hidden-feed');
    const items = feed().filter((it) => !it.ph);
    const mine = items.find((it) => it.mine);
    const shown = items.filter((it) => !it.mine).slice(0, 8);
    const others = shown.sort(() => Math.random() - 0.5).slice(0, 4);
    const opts = [mine, ...others].sort(() => Math.random() - 0.5);
    test.opts = opts;
    overlay.hidden = false;
    overlay.innerHTML = `<div class="ab-ov-box wide"><h3>Какое видео вы заметили первым?</h3>
      <div class="ab-opts">${opts.map((it, i) => `<button type="button" class="ab-opt" data-opt="${i}">${it.thumb ? `<img src="${esc(it.thumb)}" alt="">` : '<span class="ab-opt-ph"></span>'}<span>${esc(it.title || 'Без заголовка')}</span></button>`).join('')}</div>
      <div class="row"><button type="button" class="btn ghost sm" data-opt="-1">Ничего не запомнил(а)</button></div></div>`;
    $('[data-opt]', overlay).focus();
  }
  function answerTest(i) {
    const hit = i >= 0 && test.opts[i]?.mine;
    const t = (st.tests[test.id] ||= { n: 0, hit: 0 });
    t.n++; if (hit) t.hit++;
    save();
    overlay.innerHTML = `<div class="ab-ov-box"><h3 class="${hit ? 'good' : 'bad'}">${icon(hit ? 'check' : 'x', 18)} ${hit ? 'Ваш вариант запомнился' : 'Запомнилось другое видео'}</h3>
      <p>${hit ? 'Превью и заголовок цепляют взгляд среди конкурентов.' : 'Попробуйте контрастнее превью, крупнее объект или короче заголовок — и повторите тест.'}</p>
      <p class="muted small">Вариант ${test.id}: запомнился ${t.hit} из ${t.n} раз. Честный результат — когда вы не знаете, где он стоит.</p>
      <div class="row"><button type="button" class="btn" data-again>${icon('refresh', 15)} Ещё раз</button><button type="button" class="btn ghost" data-close>Закрыть</button></div></div>`;
    $('[data-again]', overlay).focus();
    renderHints();
  }
  overlay.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !test) return;
    if (b.hasAttribute('data-go')) runTest();
    else if (b.hasAttribute('data-close')) closeTest();
    else if (b.hasAttribute('data-again')) { closeTest(); startTest(); }
    else if (b.dataset.opt != null) answerTest(+b.dataset.opt);
  });

  /* ---------- события ---------- */
  const vars = $('#abVars', root);
  vars.addEventListener('focusin', (e) => { const c = e.target.closest('[data-v]'); if (c) editVar = c.dataset.v; });
  vars.addEventListener('pointerdown', (e) => { const c = e.target.closest('[data-v]'); if (c) editVar = c.dataset.v; });
  vars.addEventListener('click', (e) => {
    const card = e.target.closest('[data-v]');
    if (!card) return;
    const id = card.dataset.v;
    if (e.target.closest('[data-clear]')) {
      Object.assign(v(id), blankVar(id));
      renderVar(id); renderPreview(); renderHints(); save();
      return;
    }
    if (e.target.closest('.ab-drop') && !e.target.closest('input')) $('[data-file]', card).click();
  });
  vars.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ab-drop')) { e.preventDefault(); $('[data-file]', e.target).click(); }
  });
  vars.addEventListener('change', (e) => {
    if (e.target.matches('[data-file]')) { const f = e.target.files?.[0]; e.target.value = ''; if (f) setThumb(e.target.closest('[data-v]').dataset.v, f); }
  });
  vars.addEventListener('dragover', (e) => {
    const d = e.target.closest('.ab-drop');
    if (!d) return;
    e.preventDefault();
    d.classList.add('drag');
  });
  vars.addEventListener('dragleave', (e) => { const d = e.target.closest('.ab-drop'); if (d && !d.contains(e.relatedTarget)) d.classList.remove('drag'); });
  vars.addEventListener('drop', (e) => {
    const d = e.target.closest('.ab-drop');
    if (!d) return;
    e.preventDefault();
    d.classList.remove('drag');
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/')) || e.dataTransfer?.files?.[0];
    if (f) setThumb(d.closest('[data-v]').dataset.v, f);
  });
  let titleT = 0;
  vars.addEventListener('input', (e) => {
    if (!e.target.matches('[data-title]')) return;
    const card = e.target.closest('[data-v]'), id = card.dataset.v, x = v(id);
    const had = hasContent(x);
    x.title = e.target.value.replace(/[\r\n]+/g, ' ');
    if (x.title !== e.target.value) e.target.value = x.title;
    $('[data-count]', card).innerHTML = countHtml(x.title);
    if (had !== hasContent(x)) { const head = $('.ab-var-head', card); if (hasContent(x) && !$('[data-clear]', head)) head.insertAdjacentHTML('beforeend', `<button type="button" class="btn ghost sm" data-clear title="Очистить вариант">${icon('trash', 14)}</button>`); }
    if (!hasContent(v(st.active))) st.active = id;
    clearTimeout(titleT);
    titleT = setTimeout(() => {
      if (!root.isConnected) return;
      $('[data-trunc]', card).innerHTML = truncHtml(x.title);
      syncQueryPh();
      renderPreview(); renderHints();
    }, 180);
    save();
  });

  // вставка картинки из буфера обмена — в вариант, с которым работали последним
  const onPaste = (e) => {
    if (!root.isConnected) return document.removeEventListener('paste', onPaste);
    const f = [...(e.clipboardData?.items || [])].find((it) => it.kind === 'file' && it.type.startsWith('image/'))?.getAsFile();
    if (!f) return;
    e.preventDefault();
    setThumb(editVar, f);
  };
  document.addEventListener('paste', onPaste);
  const onKey = (e) => {
    if (!root.isConnected) return document.removeEventListener('keydown', onKey);
    if (e.key === 'Escape' && test) { closeTest(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    const i = ['1', '2', '3'].indexOf(e.key);
    if (i < 0 || test) return;
    const id = VARS[i];
    if (!hasContent(v(id))) return toast(`Вариант ${id} пуст`);
    st.active = id; editVar = id;
    renderPreview(); save();
  };
  document.addEventListener('keydown', onKey);

  $('#abChan', root).addEventListener('input', (e) => { st.channel.name = e.target.value; paintAvatar(); renderPreview(); save(); });
  $('#abViews', root).addEventListener('input', (e) => { st.viewsText = e.target.value; renderPreview(); save(); });
  $('#abAgo', root).addEventListener('input', (e) => { st.agoText = e.target.value; renderPreview(); save(); });
  $('#abDur', root).addEventListener('input', (e) => { st.duration = e.target.value.trim(); renderPreview(); save(); });
  $('#abQ', root).addEventListener('input', (e) => { st.query = e.target.value.trim(); st.queryAuto = !st.query; save(); });
  $('#abQ', root).addEventListener('change', () => renderHints());
  $('#abQForm', root).addEventListener('submit', (e) => { e.preventDefault(); loadCtx('search'); });
  $('#abMine', root).addEventListener('click', () => myId && loadCtx('mine'));
  avBtn.addEventListener('click', () => $('#abAvFile', root).click());
  $('#abAvFile', root).addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { st.channel.avatar = (await readImage(f, MAX_AVATAR)).url; paintAvatar(); renderPreview(); save(); } catch (err) { toast(err.message, true); }
  });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lay],[data-yt],[data-show]');
    if (!b || test) return;
    if (b.dataset.lay) st.layout = b.dataset.lay;
    else if (b.dataset.yt) st.theme = b.dataset.yt;
    else { st.active = b.dataset.show; editVar = st.active; }
    renderPreview(); save();
  });
  $('#abPos', root).addEventListener('change', (e) => { st.pos = e.target.value; if (st.pos === 'rand') st.rand = Math.random(); renderPreview(); save(); });
  $('#abShuffle', root).addEventListener('click', () => {
    if (test) return;
    if (!st.ctx.videos.length) return toast('Сначала загрузите конкурентов', true);
    shuffle(); renderPreview(); save();
  });
  $('#abTest', root).addEventListener('click', () => { if (test) closeTest(); startTest(); });
  $('#abHl', root).addEventListener('change', (e) => { st.highlight = e.target.checked; renderPreview(); save(); });

  /* ---------- старт ---------- */
  VARS.forEach(renderVar);
  fillCtxInputs();
  renderPreview();
  renderHints();
  if (st.ctx.videos.length) analyzeComps();
  // название и аватар своего канала из настроек
  if (myId && (!st.channel.name || !st.channel.avatar || st.channel.id !== myId)) {
    channelPage(myId).then(({ channel }) => {
      if (!root.isConnected || !channel) return;
      if (!st.channel.name || st.channel.id !== myId) st.channel.name = channel.title || st.channel.name;
      if (channel.thumb && (!st.channel.avatar || st.channel.id !== myId)) st.channel.avatar = channel.thumb;
      st.channel.id = myId;
      $('#abChan', root).value = st.channel.name;
      paintAvatar(); renderPreview(); save();
    }).catch((e) => console.warn('abtest: канал не загружен', e));
  }
}
