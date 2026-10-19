import { $, $$, esc, fmt, icon, toast, bg, timeAgo, pageHead, loadingHtml, errorHtml } from '../ui.js';
import { TYPES, INTERVALS, PERMS, getRules, saveRules, newRule, describe, deleteRule, getHistory, hasPerms } from '../../lib/alerts.js';
import { resolveChannelId } from '../../lib/youtube.js';
import { getData, setData, getSettings } from '../../lib/storage.js';

const INTERVAL_LABEL = { 30: 'каждые 30 мин', 60: 'каждый час', 180: 'каждые 3 ч', 360: 'каждые 6 ч' };
const HELP = {
  niche: 'Ищет свежие видео по запросу (сортировка по дате) и сообщает о тех, что набирают в разы больше просмотров, чем подписчиков у канала, или быстро растут в час.',
  newVideo: 'Сообщает о каждом новом ролике выбранных каналов с ранней скоростью набора просмотров. Первая проверка только запоминает текущие видео.',
  spike: 'Сообщает, когда недавнее видео конкурента обгоняет медиану своего канала в K раз.',
  milestone: 'Следит за своим каналом (Настройки → мой канал): круглые рубежи (1K, 10K, 100K…) или каждые +N%.',
};

// Права запрашиваются только по клику (нужен жест пользователя); без них работает только ручная проверка
async function requestPerms() {
  try { return await chrome.permissions.request(PERMS); } catch (e) { console.warn(e); return false; }
}

export async function render(root, _params, stale = () => false) {
  root.innerHTML = `<div class="v-alerts">
    ${pageHead('Уведомления', 'Следите за трендами без ручных проверок: аутлаеры в нише, новые и «взлетевшие» видео конкурентов, рубежи своего канала.')}
    <div id="al-sched"></div>
    <div class="section-head"><h2>Правила</h2><span class="muted small" id="al-count"></span></div>
    <div id="al-rules"></div>
    <div class="section-head"><h2>Новое правило</h2></div>
    <div id="al-form"></div>
    <div class="section-head"><h2>История</h2><button class="btn ghost sm" id="al-clear" hidden>${icon('trash', 14)} Очистить</button></div>
    <div id="al-hist"></div></div>`;

  await Promise.all([drawSchedule(root), drawRules(root), drawHistory(root)]);
  if (stale()) return;
  drawForm(root);
  bg('alertsRead').catch(() => {});

  $('#al-clear', root).addEventListener('click', async () => {
    await setData('alertHistory', []);
    drawHistory(root);
  });

  // фоновая проверка дописала историю — обновляем, пока экран открыт
  const onChange = (ch) => {
    if (!root.isConnected) return chrome.storage.onChanged.removeListener(onChange);
    if (ch.alertHistory) { drawHistory(root); bg('alertsRead').catch(() => {}); }
    if (ch.alerts && !root.querySelector('.al-rule [data-busy]')) drawRules(root);
  };
  chrome.storage.onChanged.addListener(onChange);
}

// ---------- расписание и разрешения ----------
async function drawSchedule(root) {
  const box = $('#al-sched', root);
  let st;
  try { st = await bg('alertsStatus'); } catch { st = { enabled: false, minutes: 60, granted: await hasPerms() }; }
  const on = st.enabled && st.granted;
  box.innerHTML = `<div class="card al-sched">
    <div class="al-sched-row">
      <label class="check al-master"><input type="checkbox" id="al-on" ${on ? 'checked' : ''}> <span><b>Проверять в фоне</b><span class="muted small">Системные уведомления Chrome, клик открывает видео</span></span></label>
      <select id="al-int" aria-label="Интервал проверки">${INTERVALS.map((m) => `<option value="${m}" ${m === st.minutes ? 'selected' : ''}>${INTERVAL_LABEL[m]}</option>`).join('')}</select>
    </div>
    <div class="al-status small">
      <span class="al-pill ${st.granted ? 'ok' : ''}">${icon(st.granted ? 'check' : 'alert', 13)} ${st.granted ? 'Разрешения выданы' : 'Нужны разрешения: фоновые таймеры и уведомления'}</span>
      ${on && st.next ? `<span class="muted">Следующая проверка: <span class="mono">${esc(new Date(st.next).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span></span>` : ''}
      ${st.lastRun ? `<span class="muted">Последняя: ${esc(timeAgo(st.lastRun))}</span>` : ''}
      ${!st.granted ? '<button class="btn ghost sm" id="al-grant">Выдать разрешения</button>' : ''}
      ${on ? `<button class="btn ghost sm" id="al-all">${icon('refresh', 14)} Проверить все сейчас</button>` : ''}
    </div>
    <div id="al-perm-msg"></div></div>`;

  const denied = () => {
    $('#al-perm-msg', box).innerHTML = `<div class="notice">${icon('alert', 16)}<div>Без разрешений Chrome не даст TubeLens просыпаться по расписанию и показывать уведомления. Правила можно проверять вручную кнопкой «Проверить». Разрешения можно выдать позже — здесь или в chrome://extensions.</div></div>`;
  };
  const apply = async (enabled, minutes) => {
    try {
      await bg('alertsSchedule', { enabled, minutes });
    } catch (e) { toast(e.message, true); }
    drawSchedule(root);
  };

  $('#al-on', box).addEventListener('change', async (e) => {
    const want = e.target.checked;
    const minutes = +$('#al-int', box).value;
    if (want && !st.granted) {
      // request — первым вызовом в обработчике, пока действует жест пользователя
      const ok = await requestPerms();
      if (!ok) { e.target.checked = false; denied(); return; }
    }
    await apply(want, minutes);
    if (want) toast(`Фоновая проверка включена: ${INTERVAL_LABEL[minutes]}`);
  });
  $('#al-int', box).addEventListener('change', (e) => apply(st.enabled, +e.target.value));
  $('#al-grant', box)?.addEventListener('click', async () => {
    const ok = await requestPerms();
    if (!ok) return denied();
    await apply(true, +$('#al-int', box).value);
    toast('Разрешения выданы, фоновая проверка включена');
  });
  $('#al-all', box)?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const res = await bg('alertsRunNow', {});
      const n = res.reduce((s, r) => s + (r.fresh || 0), 0);
      toast(n ? `Новых находок: ${n}` : 'Ничего нового');
      drawHistory(root);
      drawRules(root);
    } catch (err) { toast(err.message, true); }
    b.disabled = false;
  });
}

// ---------- список правил ----------
async function drawRules(root) {
  const box = $('#al-rules', root);
  const rules = await getRules();
  $('#al-count', root).textContent = rules.length ? `${rules.filter((r) => r.enabled).length} из ${rules.length} включено` : '';
  if (!rules.length) {
    box.innerHTML = '<div class="empty">Правил пока нет. Добавьте первое ниже — например, «Аутлаер в нише» по своей теме.</div>';
    return;
  }
  box.innerHTML = rules.map((r) => {
    const t = TYPES[r.type] || { title: r.type, icon: 'bell' };
    const meta = r.lastError ? `<span class="bad">${icon('alert', 12)} ${esc(r.lastError)}</span>`
      : r.lastRun ? `проверено ${esc(timeAgo(r.lastRun))}${r.lastFound ? ` · новых: <span class="mono">${r.lastFound}</span>` : ''}` : 'ещё не проверялось';
    return `<div class="card al-rule ${r.enabled ? '' : 'off'}" data-id="${esc(r.id)}">
      <div class="al-rule-head">
        <span class="al-ic">${icon(t.icon, 18)}</span>
        <div class="al-rule-t"><b>${esc(t.title)}</b><div class="muted small">${esc(describe(r))}</div><div class="muted small al-meta">${meta}</div></div>
        <label class="check al-toggle" title="Включено"><input type="checkbox" data-en ${r.enabled ? 'checked' : ''} aria-label="Правило включено"><span class="small">Вкл.</span></label>
        <button class="btn ghost sm" data-run>${icon('search', 14)} Проверить</button>
        <button class="icon-btn" data-del title="Удалить правило" aria-label="Удалить правило">${icon('trash', 15)}</button>
      </div>
      <div class="al-found" data-out></div></div>`;
  }).join('');

  $$('.al-rule', box).forEach((card) => {
    const id = card.dataset.id;
    $('[data-en]', card).addEventListener('change', async (e) => {
      const list = await getRules();
      const r = list.find((x) => x.id === id);
      if (r) r.enabled = e.target.checked;
      await saveRules(list);
      card.classList.toggle('off', !e.target.checked);
    });
    $('[data-del]', card).addEventListener('click', async () => {
      await deleteRule(id);
      drawRules(root);
    });
    $('[data-run]', card).addEventListener('click', async (e) => {
      const b = e.currentTarget, out = $('[data-out]', card);
      b.disabled = true;
      b.dataset.busy = '1';
      out.innerHTML = loadingHtml('Проверяю…');
      try {
        const [res] = await bg('alertsRunNow', { id });
        out.innerHTML = res.error ? errorHtml(new Error(res.error)) : foundHtml(res);
      } catch (err) { out.innerHTML = errorHtml(err); }
      b.disabled = false;
      delete b.dataset.busy;
    });
  });
}

function foundHtml(res) {
  if (res.current) {
    const c = res.current;
    const cur = `<div class="muted small">Сейчас: ${c.subs != null ? `<span class="mono">${fmt(c.subs)}</span> подписчиков` : ''}${c.views != null ? ` · <span class="mono">${fmt(c.views)}</span> просмотров` : ''}</div>`;
    if (!res.items.length) return cur + '<div class="muted small">Новых рубежей нет — уведомим, когда канал перейдёт следующий.</div>';
  }
  if (!res.items.length) return '<div class="muted small al-none">Сейчас подходящих видео нет. Попробуйте снизить пороги.</div>';
  return `<div class="muted small">Найдено: <span class="mono">${res.items.length}</span>${res.items.some((x) => x.seen) ? ' · отмеченные «было» уже приходили в уведомлениях' : ''}</div>
    <ul class="al-list">${res.items.slice(0, 20).map(itemHtml).join('')}</ul>`;
}

function itemHtml(x) {
  const badges = [
    x.ratio != null ? `<span class="badge ${x.ratio >= 3 ? 'hot' : 'up'}">×${x.ratio.toFixed(1)} к подп.</span>` : '',
    x.out != null ? `<span class="badge hot">×${x.out.toFixed(1)} к медиане</span>` : '',
    x.vph != null ? `<span class="badge">${fmt(x.vph)}/ч</span>` : '',
    x.seen ? '<span class="badge">было</span>' : '',
  ].join('');
  return `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${x.thumb ? `<img loading="lazy" src="${esc(x.thumb)}" alt="">` : `<span class="al-ic">${icon('bell', 16)}</span>`}
    <span class="al-li-t"><b>${esc(x.videoTitle || x.title)}</b><span class="muted small">${esc(x.channelTitle || x.message || '')}${x.views != null ? ` · ${fmt(x.views)} просм.` : ''}${x.publishedText ? ` · ${esc(x.publishedText)}` : ''}</span></span>
    <span class="al-badges">${badges}</span></a></li>`;
}

// ---------- форма нового правила ----------
function drawForm(root) {
  const box = $('#al-form', root);
  let type = 'niche';
  const draw = async () => {
    const d = TYPES[type].defaults;
    const comp = (await getData('competitors', [])).length;
    const { myChannel } = await getSettings();
    const chFields = `
      <label class="check"><input type="checkbox" data-p="useCompetitors" ${d.useCompetitors ? 'checked' : ''}> Каналы из раздела «Конкуренты» <span class="muted small">(${comp})</span></label>
      <label for="al-ch">Дополнительные каналы — по одному в строке</label>
      <textarea id="al-ch" data-p="channels" rows="3" placeholder="@handle, ссылка или ID канала"></textarea>`;
    const num = (k, l, step = 1) => `<div><label for="al-${k}">${l}</label><input id="al-${k}" type="number" min="0" step="${step}" data-p="${k}" value="${esc(d[k])}"></div>`;
    const fields = {
      niche: `<label for="al-q">Ключевое слово или ниша</label>
        <div class="search">${icon('search', 16)}<input id="al-q" data-p="q" required placeholder="например: монтаж видео"></div>
        <div class="al-grid">${num('days', 'Видео не старше, дней')}${num('ratio', 'Просмотры/подписчики ≥', 0.5)}${num('vph', 'или просмотров в час ≥ (0 — выкл.)', 50)}${num('minViews', 'Минимум просмотров', 100)}</div>`,
      newVideo: chFields,
      spike: chFields + `<div class="al-grid">${num('k', 'Во сколько раз выше медианы канала', 0.5)}${num('days', 'Видео не старше, дней')}</div>`,
      milestone: (myChannel ? '' : `<div class="notice">${icon('alert', 16)}<div>Сначала укажите свой канал в <a href="#/settings">Настройках</a>.</div></div>`) + `<div class="al-grid">
        <div><label for="al-metric">Метрика</label><select id="al-metric" data-p="metric"><option value="subs">Подписчики</option><option value="views">Просмотры</option><option value="both">Подписчики и просмотры</option></select></div>
        <div><label for="al-mode">Когда сообщать</label><select id="al-mode" data-p="mode"><option value="round">Круглые рубежи (1K, 10K, 100K…)</option><option value="pct">Каждые +N%</option></select></div>
        ${num('pct', 'N, % (для режима +N%)')}</div>`,
    };
    box.innerHTML = `<form class="card al-form" id="al-f">
      <div class="seg al-types" role="group" aria-label="Тип уведомления">${Object.entries(TYPES).map(([k, t]) => `<button type="button" data-t="${k}" class="${k === type ? 'on' : ''}" aria-pressed="${k === type}">${icon(t.icon, 14)} ${esc(t.title)}</button>`).join('')}</div>
      <p class="muted small al-help">${esc(HELP[type])}</p>
      ${fields[type]}
      <div class="row al-actions"><button class="btn">${icon('plus', 15)} Добавить правило</button></div></form>`;
    $$('[data-t]', box).forEach((b) => b.addEventListener('click', () => { type = b.dataset.t; draw(); }));
    $('#al-f', box).addEventListener('submit', submit);
  };

  const submit = async (e) => {
    e.preventDefault();
    const f = e.currentTarget, btn = $('button.btn', f);
    const p = {};
    for (const el of $$('[data-p]', f)) {
      const k = el.dataset.p;
      if (el.type === 'checkbox') p[k] = el.checked;
      else if (el.type === 'number') p[k] = Math.max(0, +el.value || 0);
      else if (k !== 'channels') p[k] = el.value.trim();
    }
    btn.disabled = true;
    try {
      if (type === 'niche' && !p.q) throw new Error('Укажите ключевое слово');
      if (type === 'newVideo' || type === 'spike') {
        const lines = ($('#al-ch', f).value || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        p.channels = [];
        for (const l of lines.slice(0, 20)) {
          try { p.channels.push(await resolveChannelId(l)); } catch { throw new Error('Канал не найден: ' + l); }
        }
        if (!p.useCompetitors && !p.channels.length) throw new Error('Выберите каналы: конкуренты или свой список');
      }
      const list = await getRules();
      list.push(newRule(type, p));
      await saveRules(list);
      toast('Правило добавлено');
      await drawRules(root);
      draw();
    } catch (err) { toast(err.message, true); }
    btn.disabled = false;
  };
  draw();
}

// ---------- история ----------
async function drawHistory(root) {
  const box = $('#al-hist', root);
  const list = await getHistory();
  $('#al-clear', root).hidden = !list.length;
  if (!list.length) {
    box.innerHTML = '<div class="empty">Здесь появятся находки фоновых проверок — даже если системное уведомление вы пропустили.</div>';
    return;
  }
  box.innerHTML = `<ul class="al-list al-hist">${list.map((h) => `<li><a href="${esc(h.url || '#')}" target="_blank" rel="noopener">
    ${h.thumb ? `<img loading="lazy" src="${esc(h.thumb)}" alt="">` : `<span class="al-ic">${icon((TYPES[h.type] || {}).icon || 'bell', 16)}</span>`}
    <span class="al-li-t"><b>${esc(h.title)}</b><span class="muted small al-msg">${esc(h.message || '')}</span></span>
    <span class="muted small al-when">${esc(timeAgo(h.at))}</span></a></li>`).join('')}</ul>`;
}
