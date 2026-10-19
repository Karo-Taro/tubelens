// Статистика своего канала в шапке YouTube (компактная «пилюля» рядом с кнопкой «Создать»).
// Обычный скрипт (не модуль), изолированный мир; данные — через background.js.
(() => {
  if (window.__tlMasthead) return;
  window.__tlMasthead = true;

  // ---------- помощники ----------
  let dead = false; // контекст расширения потерян (расширение перезагружено)
  const send = (msg) =>
    new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (r?.error) return reject(new Error(r.error));
          resolve(r?.data);
        });
      } catch (e) {
        dead = true;
        reject(e);
      }
    });

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (n) => {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n), f = (x, s) => x.toFixed(1).replace(/\.0$/, '') + s;
    return a >= 1e9 ? f(n / 1e9, 'B') : a >= 1e6 ? f(n / 1e6, 'M') : a >= 1e3 ? f(n / 1e3, 'K') : String(Math.round(n));
  };
  const full = (n) => (n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('ru-RU'));
  const signed = (n) => (n == null || !isFinite(n) ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n)));

  const IC = {
    logo: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="m9 8 4 2.5L9 13z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    up: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-7"/>',
    swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/>',
  };
  const ic = (n, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;

  let logged = false;
  const logOnce = (...a) => { if (!logged) { logged = true; console.warn('[TubeLens]', ...a); } };

  // ---------- состояние ----------
  let myId = '';       // id канала (UC…), для которого показываем статистику
  let stats = null;    // последний ответ myStats
  let state = 'idle';  // idle | loading | ok | error
  let pill = null, menu = null;
  let settingsChecked = false; // настройки прочитаны хотя бы раз

  // ---------- автоопределение своего канала ----------
  const OWN_RE = /ваш канал|your channel|мій канал/i;
  const CH_HREF = /^\/(channel\/UC[\w-]{22}|@[^/?#]+)/;

  function hrefFromDom() {
    // (a) раздел «Вы» в боковом меню: пункт «Ваш канал»
    for (const a of document.querySelectorAll('ytd-guide-entry-renderer a[href^="/channel/UC"], ytd-guide-entry-renderer a[href^="/@"]')) {
      const entry = a.closest('ytd-guide-entry-renderer');
      const label = [a.getAttribute('title'), entry?.getAttribute('title'), a.textContent, entry?.textContent].filter(Boolean).join(' ');
      if (OWN_RE.test(label)) {
        const m = (a.getAttribute('href') || '').match(CH_HREF);
        if (m) return m[0];
      }
    }
    // меню аккаунта (если пользователь его открывал): ссылка «Посмотреть канал»
    const acc = document.querySelector('ytd-active-account-header-renderer a[href^="/channel/UC"], ytd-active-account-header-renderer a[href^="/@"]');
    const m = acc?.getAttribute('href')?.match(CH_HREF);
    return m ? m[0] : '';
  }

  const loggedIn = () => !!document.querySelector('ytd-masthead #avatar-btn, ytd-masthead ytd-topbar-menu-button-renderer #avatar-btn, ytd-masthead button#avatar-btn');

  // (b) запасной вариант: страница «Расширенные настройки аккаунта» (только тот же origin, без перехода по редиректам)
  async function hrefFromAccountPage() {
    try {
      const r = await fetch('/account_advanced', { credentials: 'same-origin', redirect: 'manual' });
      if (r.type === 'opaqueredirect' || !r.ok) return '';
      if (new URL(r.url || location.href).hostname !== 'www.youtube.com') return '';
      const html = await r.text();
      let m = html.match(/["']?channelId["']?\s*[:=]\s*["']?(UC[\w-]{22})/);
      if (!m) {
        const i = html.search(/Channel ID|ID канала|Идентификатор канала|Ідентифікатор каналу/i);
        if (i >= 0) m = html.slice(i, i + 3000).match(/(UC[\w-]{22})/);
      }
      return m ? '/channel/' + m[1] : '';
    } catch {
      return '';
    }
  }

  let detectSent = false, detectTries = 0, accountTried = false, detecting = false;
  async function tryDetect() {
    if (detectSent || detecting || dead) return;
    detecting = true;
    try {
      detectTries++;
      let href = hrefFromDom();
      if (!href && detectTries >= 3 && !accountTried && loggedIn()) {
        accountTried = true;
        href = await hrefFromAccountPage();
      }
      if (!href) return;
      detectSent = true;
      const r = await send({ type: 'detectedChannel', href });
      if (r?.id) { myId = r.id; load(); }
    } catch (e) {
      logOnce('не удалось определить канал:', e.message);
    } finally {
      detecting = false;
    }
  }

  // ---------- загрузка ----------
  let loadingNow = false;
  async function load() {
    if (loadingNow || dead) return;
    loadingNow = true;
    try {
      const s = await send({ type: 'settings' });
      if (s?.myChannel) myId = s.myChannel;
      settingsChecked = true;
      if (!myId) { state = 'idle'; render(); return; }
      if (!stats || stats.id !== myId) { state = 'loading'; render(); }
      const d = await send({ type: 'myStats', id: myId });
      if (!d) throw new Error('нет данных по каналу ' + myId);
      stats = d; state = 'ok';
    } catch (e) {
      state = 'error'; stats = null;
      logOnce('статистика канала недоступна:', e.message);
    } finally {
      loadingNow = false;
      render();
      if (menu) renderMenu();
    }
  }

  // ---------- пилюля ----------
  function makePill() {
    const el = document.createElement('button');
    el.id = 'tl-stats-pill';
    el.type = 'button';
    el.setAttribute('aria-haspopup', 'dialog');
    el.addEventListener('click', (e) => { e.stopPropagation(); menu ? closeMenu() : openMenu(); });
    return el;
  }

  function render() {
    if (!pill) return;
    const show = state === 'loading' || state === 'ok';
    pill.hidden = !show;
    pill.classList.toggle('tl-loading', state === 'loading');
    if (!show) { closeMenu(); return; }
    if (state === 'loading') {
      pill.title = 'TubeLens: загрузка статистики канала…';
      pill.innerHTML = `<span class="tl-sp-logo">${ic('logo', 16)}</span><span class="tl-sp-skel"></span><span class="tl-sp-skel"></span>`;
      return;
    }
    const d = stats, g = [];
    pill.title = '';
    pill.setAttribute('aria-label', `TubeLens: статистика канала ${d.title || ''}`);
    g.push(`<span class="tl-sp-g" title="Подписчики: ${d.subsApprox ? '≈' : ''}${full(d.subs)}${d.subsApprox ? ' (YouTube округляет)' : ''}">${ic('user')}<b>${d.subsApprox ? '≈' : ''}${fmt(d.subs)}</b></span>`);
    if (d.views != null) g.push(`<span class="tl-sp-g" title="Всего просмотров канала: ${full(d.views)}">${ic('eye')}<b>${fmt(d.views)}</b></span>`);
    if (d.last && d.last.vph != null) g.push(`<span class="tl-sp-g" title="Просмотров в час у последнего видео: ${full(d.last.vph)}/ч\n«${esc(d.last.title)}»">${ic('bolt')}<b>${fmt(d.last.vph)}</b><i>/ч</i></span>`);
    if (d.delta && d.delta.views != null) {
      const subsTxt = d.delta.subs != null ? `, подписчиков ${signed(d.delta.subs)}` : '';
      g.push(`<span class="tl-sp-g tl-sp-delta${d.delta.views < 0 ? ' tl-neg' : ''}" title="Рост за последние ${d.delta.hours}ч: просмотров ${signed(d.delta.views)}${subsTxt}">${ic('up')}<b>${signed(d.delta.views)}</b></span>`);
    }
    pill.innerHTML = `<span class="tl-sp-logo" title="TubeLens — ваш канал">${ic('logo', 16)}</span>${g.join('')}`;
  }

  // Вставка в шапку: перед «Фильтрами» (если есть), иначе перед #buttons. Идемпотентно.
  function ensure() {
    if (dead) return;
    const end = document.querySelector('ytd-masthead #end');
    if (!end) return;
    if (!pill) { pill = makePill(); render(); }
    const filters = end.querySelector(':scope > #tl-filters-btn');
    const buttons = end.querySelector(':scope > #buttons');
    const before = filters || buttons || null;
    // убираем возможные дубликаты (например, после повторной инъекции)
    document.querySelectorAll('#tl-stats-pill').forEach((x) => { if (x !== pill) x.remove(); });
    if (pill.parentNode !== end || (before && pill.nextElementSibling !== before)) {
      end.insertBefore(pill, before);
    }
  }

  // ---------- выпадающая карточка ----------
  function openMenu() {
    if (!stats || state !== 'ok') return;
    menu = document.createElement('div');
    menu.id = 'tl-stats-menu';
    menu.setAttribute('role', 'dialog');
    menu.addEventListener('click', onMenuClick);
    document.body.appendChild(menu);
    renderMenu();
    place();
    pill.classList.add('tl-open');
    pill.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    if (pill) { pill.classList.remove('tl-open'); pill.setAttribute('aria-expanded', 'false'); }
  }

  function place() {
    if (!menu || !pill || !pill.isConnected) return closeMenu();
    const r = pill.getBoundingClientRect();
    if (!r.width) return closeMenu();
    const w = menu.offsetWidth || 320;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    menu.style.top = Math.round(r.bottom + 6) + 'px';
    menu.style.left = Math.round(left) + 'px';
  }

  function renderMenu() {
    if (!menu) return;
    const d = stats;
    if (!d) return closeMenu();
    const handle = d.handle ? (d.handle.startsWith('@') ? d.handle : '@' + d.handle) : '';
    const chUrl = handle ? '/' + handle : '/channel/' + d.id;
    const cell = (icon, label, val, tip, extra = '') => `<div class="tl-sm-cell${extra}" title="${esc(tip)}"><span>${ic(icon, 13)} ${label}</span><b>${val}</b></div>`;
    const cells = [
      cell('user', 'Подписчики', (d.subsApprox ? '≈' : '') + fmt(d.subs), `${d.subsApprox ? '≈' : ''}${full(d.subs)}`),
      cell('eye', 'Просмотры', fmt(d.views), full(d.views)),
      cell('film', 'Видео', fmt(d.videos), full(d.videos)),
    ];
    if (d.delta) {
      const v = d.delta.views, s = d.delta.subs;
      cells.push(cell('up', `За ${d.delta.hours}ч`, `${signed(v)}<small> просм.</small>`,
        `Рост за последние ${d.delta.hours}ч: просмотров ${signed(v)}, подписчиков ${signed(s)}`, v != null && v >= 0 ? ' tl-sm-pos' : ''));
    } else {
      cells.push(cell('up', 'Рост', '<small>завтра</small>', 'Динамика появится, когда накопится замер примерно суточной давности'));
    }
    const last = d.last
      ? `<a class="tl-sm-last" href="/watch?v=${encodeURIComponent(d.last.id)}" title="Открыть последнее видео">
          <span class="tl-sm-lbl">Последнее видео${d.last.publishedText ? ' · ' + esc(d.last.publishedText) : ''}</span>
          <span class="tl-sm-vt">${esc(d.last.title)}</span>
          <span class="tl-sm-vm">${ic('eye', 12)} <b>${fmt(d.last.views)}</b> <span class="tl-sm-dot">·</span> ${ic('bolt', 12)} <span><b>${fmt(d.last.vph)}</b>/ч</span></span>
        </a>`
      : '';
    menu.innerHTML = `
      <div class="tl-sm-head">
        ${d.thumb ? `<img class="tl-sm-ava" src="${esc(d.thumb)}" alt="" referrerpolicy="no-referrer">` : `<span class="tl-sm-ava tl-sm-ava0">${ic('user', 20)}</span>`}
        <div class="tl-sm-id">
          <a class="tl-sm-title" href="${esc(chUrl)}">${esc(d.title || d.id)}</a>
          <span class="tl-sm-handle">${esc(handle || d.id)}</span>
        </div>
        <span class="tl-sm-brand" title="TubeLens">${ic('logo', 16)}</span>
      </div>
      <div class="tl-sm-grid">${cells.join('')}</div>
      ${last}
      <div class="tl-sm-actions">
        <button type="button" class="tl-sm-btn tl-sm-primary" data-act="audit">${ic('chart', 14)} Аудит канала</button>
        <button type="button" class="tl-sm-btn" data-act="change">${ic('swap', 14)} Сменить канал</button>
      </div>`;
  }

  function onMenuClick(e) {
    const b = e.target.closest('[data-act]');
    if (b) {
      const act = b.dataset.act;
      send({ type: 'open', route: act === 'audit' ? 'channel?q=' + encodeURIComponent(stats?.id || myId) : 'settings' }).catch((er) => logOnce('не удалось открыть приложение:', er.message));
      closeMenu();
      return;
    }
    if (e.target.closest('a[href]')) closeMenu(); // переход внутри YouTube (SPA)
  }

  document.addEventListener('mousedown', (e) => {
    if (menu && !menu.contains(e.target) && !pill?.contains(e.target)) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu) { closeMenu(); pill?.focus(); } }, true);
  window.addEventListener('resize', () => { if (menu) place(); });
  document.addEventListener('yt-navigate-start', closeMenu);

  // ---------- запуск ----------
  const tick = () => {
    try { if (!chrome.runtime?.id) dead = true; } catch { dead = true; }
    if (dead) { closeMenu(); pill?.remove(); clearInterval(refreshTimer); return; } // расширение обновлено/отключено — убираем пилюлю
    ensure();
    if (settingsChecked && !myId && !detectSent) tryDetect();
  };
  document.addEventListener('yt-navigate-finish', () => setTimeout(tick, 50));
  const tickTimer = setInterval(() => { if (dead) clearInterval(tickTimer); else tick(); }, 2000);
  const refreshTimer = setInterval(() => { if (dead) clearInterval(refreshTimer); else load(); }, 10 * 60 * 1000);

  ensure();
  load().then(() => { if (settingsChecked && !myId) tryDetect(); });
})();
