// Контент-скрипт для youtube.com: панели на страницах видео, поиска и каналов.
// Обычный скрипт (не модуль) — все запросы к API идут через background.js.
(() => {
  if (window.__tlYoutube) return;
  window.__tlYoutube = true;

  // Контекст расширения потерян (расширение обновили/отключили без перезагрузки вкладки):
  // chrome.runtime.id пропадает, sendMessage бросает исключение. Тогда тихо останавливаемся.
  let dead = false;
  const alive = () => {
    if (dead) return false;
    try { if (chrome.runtime?.id) return true; } catch { /* контекст уже недоступен */ }
    stop();
    return false;
  };
  const send = (msg) =>
    new Promise((resolve, reject) => {
      if (!alive()) return reject(new Error('Расширение было обновлено — перезагрузите страницу.'));
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (r?.error) return reject(Object.assign(new Error(r.error), { code: r.code }));
          resolve(r?.data);
        });
      } catch (e) {
        stop();
        reject(new Error('Расширение было обновлено — перезагрузите страницу.'));
      }
    });

  // Линейные SVG-иконки (как в приложении)
  const IC = {
    logo: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="m9 8 4 2.5L9 13z"/>',
    sparkles: '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 11 10.1 9z"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-7"/>',
    external: '<path d="M14 3h7v7"/><path d="m21 3-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    minus: '<path d="M5 12h14"/>',
  };
  const ic = (n, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (n) => {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n), f = (x, s) => x.toFixed(1).replace(/\.0$/, '') + s;
    return a >= 1e9 ? f(n / 1e9, 'B') : a >= 1e6 ? f(n / 1e6, 'M') : a >= 1e3 ? f(n / 1e3, 'K') : String(Math.round(n));
  };
  const cls = (s) => (s >= 60 ? 'good' : s >= 40 ? 'mid' : 'bad');
  const copy = (t, el) => navigator.clipboard.writeText(t).then(() => { if (el) { const o = el.textContent; el.textContent = 'скопировано'; setTimeout(() => (el.textContent = o), 900); } }, () => {});

  function waitFor(sel, timeout = 10000) {
    return new Promise((resolve) => {
      const found = document.querySelector(sel);
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(sel);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
    });
  }

  function panel(id, title) {
    document.getElementById(id)?.remove();
    const el = document.createElement('div');
    el.id = id;
    el.className = 'tl-panel';
    el.innerHTML = `<div class="tl-head"><span class="tl-logo">${ic('logo', 15)}</span><b>TubeLens</b><span class="tl-title">${esc(title)}</span>
      <span class="tl-sp"></span><button class="tl-x" title="Свернуть">${ic('minus', 14)}</button></div><div class="tl-body"><div class="tl-muted">Загрузка…</div></div>`;
    el.querySelector('.tl-x').addEventListener('click', () => el.classList.toggle('tl-collapsed'));
    return el;
  }

  const open = (route) => send({ type: 'open', route });

  function errorText(e) {
    if (e.code === 'NO_KEY') return 'Добавьте ключ YouTube API в настройках TubeLens, чтобы видеть полную аналитику.';
    return e.message;
  }

  // ---------- страница видео ----------
  async function watchPage(vid) {
    // только внутри ytd-watch-flexy: у скрытых страниц ytd-browse (канал, главная) тоже есть #secondary
    // #secondary (а не #secondary-inner): другие расширения (Sider, YouTube Summary…) вставляются в #secondary-inner — мы выше них
    const anchor = await waitFor('ytd-watch-flexy #secondary');
    if (!anchor || new URLSearchParams(location.search).get('v') !== vid) return;
    const el = panel('tl-watch', 'Анализ видео');
    anchor.prepend(el);
    const body = el.querySelector('.tl-body');
    try {
      const r = await send({ type: 'videoReport', id: vid });
      const v = r.video;
      body.innerHTML = `
        <div class="tl-score-row">
          <div class="tl-score ${cls(r.seo.score)}"><div>${r.seo.score}</div><small>SEO</small></div>
          <div class="tl-grid">
            <div><b>${fmt(v.views)}</b><small>просмотры</small></div>
            <div><b>${fmt(v.vph)}</b><small>в час</small></div>
            <div><b>${v.eng == null ? '—' : v.eng.toFixed(2) + '%'}</b><small>вовлечённость</small></div>
            <div><b>${fmt(v.likes)}</b><small>лайки</small></div>
            ${r.channel ? `<div><b>${fmt(r.channel.subs)}</b><small>подписчики</small></div>` : ''}
            ${v.out ? `<div><b class="${v.out >= 2 ? 'good' : ''}">×${v.out.toFixed(1)}</b><small>к медиане канала</small></div>` : ''}
          </div>
        </div>
        <details class="tl-details"><summary>SEO-чеклист (${r.seo.checks.filter((c) => c.ok).length}/${r.seo.checks.length})</summary>
          <ul class="tl-check">${r.seo.checks.map((c) => `<li class="${c.ok ? 'ok' : ''}">${esc(c.text)}</li>`).join('')}</ul></details>
        <div class="tl-sub"><span>Теги (${v.tags.length})</span>${v.tags.length ? `<button class="tl-btn tl-copyall">${ic('copy')} Копировать все</button>` : ''}</div>
        <div class="tl-tags">${v.tags.length ? v.tags.map((t) => `<span class="tl-tag">${esc(t)}</span>`).join('') : '<span class="tl-muted">Тегов нет</span>'}</div>
        <div class="tl-actions">
          <button class="tl-btn tl-primary" data-open="video?id=${vid}">${ic('external')} Подробный анализ</button>
          <button class="tl-btn" data-ai>${ic('sparkles')} AI-оптимизация</button>
          ${r.channel ? `<button class="tl-btn" data-open="channel?q=${r.channel.id}">${ic('chart')} Аудит канала</button>` : ''}
        </div>
        <div class="tl-sub"><span>Скачать</span></div>
        <div class="tl-row">
          <select class="tl-select">
            <option value="best">Видео — лучшее</option><option value="1080">Видео — 1080p</option><option value="720">Видео — 720p</option>
            <option value="audio">Аудио (m4a)</option><option value="mp3">Аудио MP3</option></select>
          <button class="tl-btn tl-primary" data-dl>${ic('download')} Скачать</button><button class="tl-btn" data-thumb>${ic('image')} Обложка</button>
        </div><div class="tl-muted tl-dlmsg"></div>
        `;
      const dlMsg = body.querySelector('.tl-dlmsg');
      body.querySelector('[data-dl]').addEventListener('click', async () => {
        dlMsg.textContent = 'Отправляю в помощник загрузки…';
        try {
          await send({ type: 'dlStart', url: location.href.split('&')[0], preset: body.querySelector('.tl-select').value, title: v.title });
          dlMsg.innerHTML = 'Загрузка идёт — прогресс в <a href="#" data-open-dl>разделе «Загрузки»</a>';
          dlMsg.querySelector('[data-open-dl]').addEventListener('click', (e) => { e.preventDefault(); open('downloads'); });
        } catch (e) { dlMsg.textContent = e.message; }
      });
      body.querySelector('[data-thumb]').addEventListener('click', () =>
        send({ type: 'thumb', id: vid, title: v.title }).then(() => (dlMsg.textContent = 'Обложка скачивается'), (e) => (dlMsg.textContent = e.message)));
      body.querySelectorAll('.tl-tag').forEach((t) => t.addEventListener('click', () => copy(t.textContent, t)));
      body.querySelector('.tl-copyall')?.addEventListener('click', (e) => copy(v.tags.join(', '), e.currentTarget));
      body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => open(b.dataset.open)));
      body.querySelector('[data-ai]').addEventListener('click', () =>
        open('ai?' + new URLSearchParams({ tool: 'optimize', title: v.title, tags: v.tags.join(', '), description: v.description.slice(0, 1500) })));
    } catch (e) {
      body.innerHTML = `<div class="tl-err">${esc(errorText(e))}</div>`;
    }
  }

  // ---------- страница поиска ----------
  async function searchPage(q, settings) {
    const anchor = await waitFor('ytd-search #primary #contents, ytd-search ytd-section-list-renderer');
    if (!anchor) return;
    const el = panel('tl-search', 'Ключевое слово');
    anchor.parentElement.insertBefore(el, anchor);
    const body = el.querySelector('.tl-body');
    body.innerHTML = `<div class="tl-row"><b class="tl-q">«${esc(q)}»</b><span class="tl-sp"></span>
      <button class="tl-btn tl-primary" data-run>Оценить (≈102 ед.)</button><button class="tl-btn" data-open>Открыть в TubeLens</button></div>
      <div class="tl-kw"></div><div class="tl-sub"><span>Похожие запросы</span></div><div class="tl-tags tl-sugg"><span class="tl-muted">…</span></div>`;
    body.querySelector('[data-open]').addEventListener('click', () => open('keywords?q=' + encodeURIComponent(q)));
    body.querySelector('[data-run]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const box = body.querySelector('.tl-kw');
      box.innerHTML = '<div class="tl-muted">Анализ…</div>';
      try {
        const r = await send({ type: 'keyword', q });
        const s = r.score;
        box.innerHTML = `<div class="tl-score-row">
          <div class="tl-score ${cls(s.overall)}"><div>${s.overall}</div><small>оценка</small></div>
          <div class="tl-grid"><div><b class="${cls(s.volume)}">${s.volume}</b><small>спрос</small></div>
            <div><b class="${cls(100 - s.competition)}">${s.competition}</b><small>конкуренция</small></div>
            <div><b>${fmt(s.medViews)}</b><small>медиана просм.</small></div><div><b>${fmt(s.medSubs)}</b><small>медиана подп.</small></div></div></div>
          ${s.insights.length ? `<ul class="tl-ins">${s.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}`;
      } catch (err) {
        box.innerHTML = `<div class="tl-err">${esc(errorText(err))}</div>`;
        btn.disabled = false;
      }
    });
    send({ type: 'suggest', q }).then((list) => {
      const box = body.querySelector('.tl-sugg');
      box.innerHTML = list.length ? list.map((s) => `<a class="tl-tag" href="/results?search_query=${encodeURIComponent(s)}">${esc(s)}</a>`).join('') : '<span class="tl-muted">Нет</span>';
    }).catch(() => {});
  }

  // ---------- бейджи VPH и ×N на карточках видео ----------
  // Просмотры и возраст берём из текста карточки (без запросов), множитель — к медиане канала.
  // «1,2 млн», «195 тыс.», «195 тысяч просмотров», «1.2M views», «1,234 views», «1 234 567 просмотров», «345 тис. переглядів»
  const SPACES = /[\u00a0\u202f\u2009]/g;
  const COUNT_RE = /(\d[\d\s.,]*)\s*(млрд|миллиард\S*|мільярд\S*|млн|миллион\S*|мільйон\S*|тыс\S*|тис\S*|billion|million|thousand|[KMB](?![a-zа-я]))?(?=\s|$)/i;
  function parseViews(t) {
    t = t.replace(SPACES, ' ').trim();
    if (/^(нет|немає|no)\s/i.test(t)) return 0;
    const m = COUNT_RE.exec(t);
    if (!m) return null;
    const suf = (m[2] || '').toLowerCase();
    const mult = /^(млрд|миллиард|мільярд|billion|b$)/.test(suf) ? 1e9 : /^(млн|миллион|мільйон|million|m$)/.test(suf) ? 1e6 : /^(тыс|тис|thousand|k$)/.test(suf) ? 1e3 : 1;
    const num = m[1].replace(/\s/g, '');
    if (mult === 1) return +num.replace(/[.,]/g, '');
    return parseFloat(num.replace(',', '.')) * mult;
  }

  // Порядок важен: укр. «годин»/«год. тому» (часы) проверяется раньше рус. «год назад»/«г.» (год).
  // Понимает и сокращения видимого текста: «4 дн. назад», «2 нед.», «1 мес.», «1 г.», «5 л.», «9 ч назад»,
  // укр. «2 тиж.», «1 міс.», «1 р.», «1 год тому», англ. «4d ago», «2w ago», «3mo ago», «1y ago», «5h ago», «10m ago».
  const AGE = [[/сек|second|\d\s*s\b/i, 1], [/мин|хв|minute|\d\s*m(in)?\b/i, 60],
    [/годин|час|hour|\d\s*hr?\b|\d\s*ч(\.|\s|$)|\d\s*год\.?\s*тому/i, 3600], [/дн|(?<!тиж)день|дні|day|\d\s*d\b/i, 86400], // укр. «тиждень» — это неделя
    [/нед|тиж|week|\d\s*w\b/i, 604800], [/мес|міс|month|\d\s*mo\b/i, 2592000], [/год|лет|рік|рок|\d\s*[глр](\.|\s|$)|year|\d\s*y\b/i, 31536000]];
  function parseAgeHours(t) {
    t = t.replace(SPACES, ' ');
    if (!/(назад|тому|\bago\b)/i.test(t)) return null;
    const n = +(/(\d+)/.exec(t)?.[1] || 1);
    for (const [re, sec] of AGE) if (re.test(t)) return Math.max(1, (n * sec) / 3600);
    return null;
  }

  const ITEM_SEL = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model';
  const OUTER_SEL = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer';
  const isChannelPath = () => /^\/(@|channel\/|c\/|user\/)/.test(location.pathname);
  const medianOf = (a) => { const s = a.filter((x) => x > 0).sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

  // «/@name/videos», «/channel/UC…/shorts» → «/@name», «/channel/UC…»
  const channelHref = (h) => /^\/(@[^/?#]+|channel\/UC[\w-]+|c\/[^/?#]+|user\/[^/?#]+)/.exec(h || '')?.[0] || null;

  const medians = new Map(); // href канала → Promise<медиана>
  let medianQueue = Promise.resolve();
  function channelMedianFor(href) {
    if (!medians.has(href)) {
      // не более одного запроса за раз — не нагружаем YouTube
      const p = (medianQueue = medianQueue.then(() => {
        // карточки этого канала уже ушли со страницы (прокрутка/переход) — не тратим запрос, спросим позже заново
        if (!wanted.has(href) || ![...wanted.get(href)].some((b) => b.isConnected)) { medians.delete(href); wanted.delete(href); return 0; }
        return send({ type: 'channelMedian', href }).then((r) => r.median).catch(() => 0);
      }));
      medians.set(href, p);
    }
    return medians.get(href);
  }
  const wanted = new Map(); // href канала → Set(бейджей), которые ждут медиану

  function pill(text, cls, title) {
    const s = document.createElement('span');
    s.className = 'tl-pill' + (cls ? ' ' + cls : '');
    s.textContent = text;
    if (title) s.title = title;
    return s;
  }

  function scanCards() {
    const onChannel = isChannelPath();
    const fresh = [];
    for (const el of document.querySelectorAll(ITEM_SEL)) {
      if (el.tagName === 'YT-LOCKUP-VIEW-MODEL' && el.parentElement?.closest(OUTER_SEL)) continue;
      const a = el.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
      const vid = a && /(?:v=|shorts\/)([\w-]{11})/.exec(a.getAttribute('href'))?.[1];
      if (!vid) continue;
      if (el.dataset.tlVid === vid && el.querySelector('.tl-vb')) continue; // YouTube переиспользует узлы — сверяем ID
      el.querySelector('.tl-vb')?.remove();
      el.dataset.tlVid = vid;
      el._tlViews = 0;
      // Берём только строки метаданных (не заголовок — в нём тоже бывает «10 лет назад»).
      // Видимый текст сокращён («195 тыс.», «4 дн. назад»), полная форма — в aria-label («195 тысяч просмотров»).
      const rows = el.querySelectorAll('#metadata-line, yt-content-metadata-view-model, .yt-content-metadata-view-model-wiz');
      const spans = rows.length ? [...rows].flatMap((r) => [...r.querySelectorAll('span')]) : [...el.querySelectorAll('span')];
      const texts = spans.filter((s) => !s.closest('.tl-vb')).flatMap((s) => [s.getAttribute('aria-label'), s.textContent].map((t) => (t || '').replace(SPACES, ' ').trim()))
        .filter((t) => t && t.length < 60);
      const live = (t) => /смотрят|watching|дивл/i.test(t);
      const vt = texts.find((t) => /(просмотр|перегляд|\bviews?\b)/i.test(t) && !live(t)) ||
        (rows.length ? texts.find((t) => /^\d[\d\s.,]*\s*(млрд|млн|тыс\.?|тис\.?|[KMB])?$/i.test(t)) : null);
      const at = texts.find((t) => /(назад|тому|\bago\b)/i.test(t));
      const views = vt ? parseViews(vt) : null;
      const hours = at ? parseAgeHours(at) : null;
      if (views == null || hours == null) continue; // Shorts без даты, трансляции и т.п.
      const vph = views / hours;
      const box = document.createElement('div');
      box.className = 'tl-vb';
      box.append(pill(`${fmt(vph)} VPH`, vph >= 1000 ? 'hot' : '', 'TubeLens: в среднем просмотров в час с момента публикации'));
      const meta = el.querySelector('#metadata-line')?.parentElement || el.querySelector('yt-content-metadata-view-model')?.parentElement ||
        el.querySelector('#details, #meta, [class*="lockup-metadata"]') || el;
      meta.append(box);
      const href = onChannel ? null : channelHref(el.querySelector('a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]')?.getAttribute('href'));
      fresh.push({ el, box, views, href });
    }
    // множитель к медиане канала
    if (onChannel) {
      // только карточки текущей (видимой) страницы канала: скрытые ytd-browse (главная, прошлый канал) остаются в DOM
      const cur = (el) => !el.closest('ytd-browse[hidden]');
      const mine = fresh.filter((f) => cur(f.el));
      mine.forEach((f) => { f.el._tlViews = f.views; });
      const med = medianOf([...document.querySelectorAll('ytd-browse:not([hidden]) [data-tl-vid]')].map((el) => el._tlViews || 0));
      if (med) mine.forEach((f) => addOut(f.box, f.views / med));
    } else {
      for (const f of fresh) {
        if (!f.href) continue;
        if (!wanted.has(f.href)) wanted.set(f.href, new Set());
        wanted.get(f.href).add(f.box);
        channelMedianFor(f.href).then((med) => { wanted.delete(f.href); if (med && f.box.isConnected) addOut(f.box, f.views / med); });
      }
    }
  }

  function addOut(box, x) {
    if (!isFinite(x) || box.querySelector('.tl-out')) return;
    box.append(pill(`${x >= 10 ? Math.round(x) : x.toFixed(1)}x`, 'tl-out' + (x >= 3 ? ' hot' : x >= 1.5 ? ' up' : ''), 'TubeLens: во сколько раз больше медианы просмотров канала (последние 30 видео)'));
  }

  let cardsObs = null;
  function startBadges() {
    if (cardsObs) return;
    let timer;
    cardsObs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scanCards, 500); });
    cardsObs.observe(document.querySelector('ytd-app') || document.body, { childList: true, subtree: true });
    scanCards();
  }

  // ---------- панель канала (справа) ----------
  function svgChart(points, { height = 170 } = {}) {
    const W = 340, H = height, L = 44, R = 8, T = 10, B = 22;
    if (points.length < 2) return '<div class="tl-muted tl-chart-empty">Недостаточно данных для графика</div>';
    const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
    const vmax = Math.max(...points.map((p) => p.v)) || 1;
    const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v) => T + (1 - v / vmax) * (H - T - B);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const area = `${line}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
    const grid = [0.25, 0.5, 0.75, 1].map((k) => `<line x1="${L}" x2="${W - R}" y1="${y(vmax * k)}" y2="${y(vmax * k)}" class="g"/><text x="${L - 6}" y="${y(vmax * k) + 3}" text-anchor="end">${fmt(vmax * k)}</text>`).join('');
    const dfmt = (t) => new Date(t).toLocaleDateString('ru', { month: 'short', year: '2-digit' });
    const xt = [0, 0.33, 0.66, 1].map((k) => { const t = t0 + (t1 - t0) * k; return `<text x="${x(t)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === 1 ? 'end' : 'middle'}">${dfmt(t)}</text>`; }).join('');
    return `<div class="tl-chart"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="График накопленных просмотров">
      ${grid}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="g0"/>${xt}
      <path d="${area}" class="area"/><path d="${line}" class="ln"/>
      <line class="cross" y1="${T}" y2="${y(0)}" x1="0" x2="0" style="display:none"/><circle class="dot" r="4" style="display:none"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="hit"/></svg><div class="tl-tip" style="display:none"></div></div>`;
  }

  function wireChart(root, points, label) {
    const svg = root.querySelector('.tl-chart svg');
    if (!svg) return;
    const tip = root.querySelector('.tl-tip'), cross = svg.querySelector('.cross'), dot = svg.querySelector('.dot');
    const W = 340, L = 44, R = 8, H = svg.viewBox.baseVal.height, T = 10, B = 22;
    const t0 = points[0].t, t1 = points[points.length - 1].t, vmax = Math.max(...points.map((p) => p.v)) || 1;
    const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v) => T + (1 - v / vmax) * (H - T - B);
    svg.querySelector('.hit').addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      let best = points[0];
      for (const p of points) if (Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px)) best = p;
      cross.setAttribute('x1', x(best.t)); cross.setAttribute('x2', x(best.t)); cross.style.display = '';
      dot.setAttribute('cx', x(best.t)); dot.setAttribute('cy', y(best.v)); dot.style.display = '';
      tip.innerHTML = `<div class="tl-muted">${new Date(best.t).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' })}</div><b>${best.v.toLocaleString('ru')}</b> ${label}${best.title ? `<div class="tl-muted tl-tip-t">${esc(best.title)}</div>` : ''}`;
      tip.style.display = '';
      const left = (x(best.t) / W) * r.width;
      tip.style.left = Math.min(Math.max(left - 90, 0), r.width - 180) + 'px';
    });
    svg.querySelector('.hit').addEventListener('mouseleave', () => { tip.style.display = cross.style.display = dot.style.display = 'none'; });
  }

  const COLLAPSE_KEY = 'tl-cpanel-collapsed';
  async function channelSidePanel(ch) {
    document.getElementById('tl-cpanel')?.remove();
    const el = document.createElement('div');
    el.id = 'tl-cpanel';
    el.dataset.ch = ch; // сразу: иначе ответ по прошлому каналу подпишет панель нового
    el.className = 'tl-panel tl-side' + (localStorage.getItem(COLLAPSE_KEY) === '1' ? ' tl-min' : '');
    el.innerHTML = `<button class="tl-tab" title="TubeLens">${ic('logo', 16)}</button>
      <div class="tl-head"><span class="tl-logo">${ic('logo', 15)}</span><b>TubeLens</b>
        <div class="tl-tabs"><button data-t="overview" class="on">Обзор</button><button data-t="videos">Видео</button><button data-t="ai">AI</button></div>
        <button class="tl-x" title="Свернуть">${ic('minus', 14)}</button></div>
      <div class="tl-body"><div class="tl-muted">Загружаю канал…</div></div>`;
    document.body.append(el);
    const toggle = (min) => { el.classList.toggle('tl-min', min); localStorage.setItem(COLLAPSE_KEY, min ? '1' : '0'); };
    el.querySelector('.tl-x').addEventListener('click', () => toggle(true));
    el.querySelector('.tl-tab').addEventListener('click', () => toggle(false));
    const body = el.querySelector('.tl-body');
    const path = location.pathname;
    let r;
    try {
      r = await send({ type: 'channelPanel', href: path });
    } catch (e) {
      body.innerHTML = `<div class="tl-err">${esc(errorText(e))}</div>`;
      return;
    }
    if (location.pathname !== path || !el.isConnected) return;
    const c = r.channel;
    const views = (list) => list.map((v) => `<li><a href="/watch?v=${encodeURIComponent(v.id)}">${esc(v.title)}</a>
      <span class="tl-li-meta">${fmt(v.views)} · ${fmt(v.vph)} VPH${v.out ? ` · <b class="${v.out >= 2 ? 'good' : ''}">${v.out.toFixed(1)}x</b>` : ''}</span></li>`).join('');
    const tabs = {
      overview: () => {
        const hist = (r.history || []).map((h) => ({ t: h.t, v: h.subs }));
        return `<div class="tl-ch"><img src="${esc(c.thumb)}" alt=""><div><b>${esc(c.title)}</b><div class="tl-muted">${esc(c.handle)} · ${fmt(c.videos)} видео</div>
            <div class="tl-muted">${[c.country, c.joined ? 'с ' + c.joined : ''].filter(Boolean).map(esc).join(' · ')}</div></div></div>
          <div class="tl-seg"><button data-m="views" class="on"><small>Просмотры</small><b>${fmt(c.views)}</b></button><button data-m="subs"><small>Подписчики</small><b>${c.subsApprox ? '≈' : ''}${fmt(c.subs)}</b></button></div>
          <div class="tl-chartbox">${svgChart(r.series)}</div>
          <div class="tl-note">Накопленные просмотры по дате публикации видео (${r.covered} видео без Shorts${c.views ? `: ${fmt(r.series.at(-1)?.v)} из ${fmt(c.views)}` : ''}).</div>
          <div class="tl-grid wide">
            <div><b>${fmt(r.median)}</b><small>медиана, 30 видео</small></div>
            <div><b>${r.perWeek.toFixed(1)}</b><small>видео в неделю</small></div>
            <div><b>${c.subs ? ((r.median / c.subs) * 100).toFixed(1) + '%' : '—'}</b><small>медиана / подписчики</small></div>
          </div>
          ${r.tags.length ? `<div class="tl-sub"><span>Теги канала</span><button class="tl-btn tl-copyall">${ic('copy')} Копировать</button></div>
            <div class="tl-tags">${r.tags.map((t) => `<span class="tl-tag">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="tl-actions"><button class="tl-btn tl-primary" data-open="channel?q=${c.id}">${ic('chart')} Полный аудит</button></div>
          <script type="application/json" class="tl-hist">${JSON.stringify(hist)}</script>`;
      },
      videos: () => `${r.outliers.length ? `<div class="tl-sub"><span>Аутлаеры (×2 и выше к медиане)</span></div><ul class="tl-list">${views(r.outliers)}</ul>` : ''}
          <div class="tl-sub"><span>Самые просматриваемые</span></div><ul class="tl-list">${views(r.top)}</ul>
          <div class="tl-sub"><span>Последние</span></div><ul class="tl-list">${views(r.recent)}</ul>`,
      ai: () => `<div class="tl-muted" style="margin-bottom:8px">Ответ даст модель из настроек TubeLens.</div>
          <div class="tl-actions" style="margin-top:0">
            <button class="tl-btn" data-ask="why">${ic('sparkles')} Почему канал растёт</button>
            <button class="tl-btn" data-ask="ideas">${ic('sparkles')} 5 идей по мотивам канала</button></div>
          <div class="tl-ai-out"></div>`,
    };
    const ctx = () => `Канал: ${c.title} (${c.handle}), подписчиков ${c.subs}, всего просмотров ${c.views}, видео ${c.videos}, медиана последних 30 видео ${Math.round(r.median)}, видео в неделю ${r.perWeek.toFixed(1)}.\n` +
      `Лучшие видео:\n${r.top.map((v) => `- ${v.title} — ${v.views}`).join('\n')}\nАутлаеры:\n${r.outliers.map((v) => `- ${v.title} — x${v.out.toFixed(1)}`).join('\n') || '—'}\nТеги: ${r.tags.join(', ')}`;
    const show = (name) => {
      el.querySelectorAll('.tl-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === name));
      body.innerHTML = tabs[name]();
      if (name === 'overview') {
        wireChart(body, r.series, 'просмотров');
        body.querySelectorAll('.tl-seg button').forEach((b) => b.addEventListener('click', () => {
          body.querySelectorAll('.tl-seg button').forEach((x) => x.classList.toggle('on', x === b));
          const hist = JSON.parse(body.querySelector('.tl-hist').textContent);
          const box = body.querySelector('.tl-chartbox'), note = body.querySelector('.tl-note');
          if (b.dataset.m === 'views') {
            box.innerHTML = svgChart(r.series); wireChart(box, r.series, 'просмотров');
            note.textContent = `Накопленные просмотры по дате публикации видео (${r.covered} видео без Shorts).`;
          } else {
            box.innerHTML = svgChart(hist); if (hist.length >= 2) wireChart(box, hist, 'подписчиков');
            note.textContent = hist.length >= 2 ? `Ваши замеры: ${hist.length} точек.` : 'История подписчиков копится при каждом вашем заходе на канал (не чаще раза в 6 часов). Публичной истории у YouTube нет.';
          }
        }));
        body.querySelectorAll('.tl-tag').forEach((t) => t.addEventListener('click', () => copy(t.textContent, t)));
        body.querySelector('.tl-copyall')?.addEventListener('click', (e) => copy(r.tags.join(', '), e.currentTarget));
        body.querySelector('[data-open]')?.addEventListener('click', (e) => open(e.currentTarget.dataset.open));
      }
      if (name === 'ai') {
        body.querySelectorAll('[data-ask]').forEach((b) => b.addEventListener('click', async () => {
          const out = body.querySelector('.tl-ai-out');
          out.textContent = 'AI думает…';
          const q = b.dataset.ask === 'why'
            ? 'Объясни коротко, за счёт чего растёт этот YouTube-канал: темы, форматы, упаковка. Что можно перенять.'
            : 'Предложи 5 идей для видео по мотивам этого канала, но со своим углом. Для каждой — заголовок и хук.';
          try { out.textContent = await send({ type: 'aiAsk', prompt: ctx() + '\n\n' + q }); } catch (e) { out.innerHTML = `<span class="tl-err">${esc(e.message)}</span>`; }
        }));
      }
    };
    el.querySelectorAll('.tl-tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.t)));
    show('overview');
  }

  // ---------- роутинг SPA ----------
  let lastUrl = '';
  async function route() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    ['tl-watch', 'tl-search', 'tl-channel'].forEach((id) => document.getElementById(id)?.remove());
    let settings;
    try { settings = await send({ type: 'settings' }); } catch { return; }
    if (settings.badges !== false) startBadges();
    if (!isChannelPath()) document.getElementById('tl-cpanel')?.remove();
    if (!settings.overlay) return;
    const p = location.pathname;
    if (p === '/watch') {
      const v = new URLSearchParams(location.search).get('v');
      if (v && /^[\w-]{11}$/.test(v)) watchPage(v); // ID из URL попадает в разметку панели — только валидный
    } else if (p === '/results') {
      const q = new URLSearchParams(location.search).get('search_query');
      if (q) searchPage(q, settings);
    } else if (isChannelPath() && settings.channelPanel !== false) {
      // панель перерисовываем только при смене канала, не при переключении вкладок канала
      const ch = p.split('/').slice(0, 2).join('/') + (p.startsWith('/channel/') ? '/' + p.split('/')[2] : '');
      if (document.getElementById('tl-cpanel')?.dataset.ch !== ch) channelSidePanel(ch);
    }
  }

  const onNav = () => setTimeout(route, 300);
  document.addEventListener('yt-navigate-finish', onNav);
  // панель видео держим первой в колонке: если кто-то вставился выше — возвращаем наверх
  const keepFirst = () => {
    const w = document.getElementById('tl-watch');
    if (w?.parentElement && w.parentElement.firstElementChild !== w) w.parentElement.prepend(w);
  };
  const routeTimer = setInterval(() => { if (alive()) { route(); keepFirst(); } }, 2000);
  function stop() {
    if (dead) return;
    dead = true;
    clearInterval(routeTimer);
    cardsObs?.disconnect();
    document.removeEventListener('yt-navigate-finish', onNav);
  }
  route();
})();
