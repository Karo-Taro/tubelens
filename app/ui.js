// Общие UI-хелперы и компоненты.
import { label } from '../lib/scoring.js';
import { icon } from './icons.js';
export { icon };

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmt(n, digits = 1) {
  if (n == null || !Number.isFinite(+n)) return '—';
  const a = Math.abs(n);
  const f = (x, s) => x.toFixed(digits).replace(/\.0+$/, '') + s;
  if (a >= 1e9) return f(n / 1e9, 'B');
  if (a >= 1e6) return f(n / 1e6, 'M');
  if (a >= 1e3) return f(n / 1e3, 'K');
  return String(Math.round(n));
}

export const pct = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) + '%' : '—');

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const u = [[31536000, 'г'], [2592000, 'мес'], [604800, 'нед'], [86400, 'д'], [3600, 'ч'], [60, 'мин']];
  for (const [sec, l] of u) if (s >= sec) return Math.floor(s / sec) + ' ' + l + ' назад';
  return 'только что';
}

export function dur(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

// Запрос к background.js (загрузки и прочее, что живёт в service worker)
export async function bg(type, data = {}) {
  const r = await chrome.runtime.sendMessage({ type, ...data });
  if (r?.error) throw new Error(r.error);
  return r?.data;
}

export function go(name, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  location.hash = '#/' + name + (qs ? '?' + qs : '');
}

export function toast(msg, err = false) {
  const d = document.createElement('div');
  d.textContent = msg;
  if (err) d.className = 'err';
  $('#toast').append(d);
  setTimeout(() => d.remove(), 3000);
}

export async function copy(text) {
  await navigator.clipboard.writeText(text);
  toast('Скопировано');
}

export const scoreClass = (s, inverse = false) => {
  const v = inverse ? 100 - s : s;
  return v >= 60 ? 'good' : v >= 40 ? 'mid' : 'bad';
};
const scoreColor = (s, inv) => ({ good: 'var(--good)', mid: 'var(--mid)', bad: 'var(--bad)' })[scoreClass(s, inv)];

// Таймлайн-линейка оценки 0–100: деления, заливка до значения и «плейхед» (фирменный элемент)
export function gauge(score, title, inverse = false, showLabel = true, compact = false) {
  const v = Math.max(0, Math.min(100, Math.round(score)));
  return `<div class="ruler ${compact ? 'compact' : ''}" style="--v:${v};--c:${scoreColor(v, inverse)}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}" aria-label="${esc(title)}">
    <div class="ruler-top"><span class="ruler-val">${v}</span><span class="ruler-of">/100</span>
      <span class="ruler-t">${esc(title)}${showLabel ? `<b class="${scoreClass(v, inverse)}">${label(v)}</b>` : ''}</span></div>
    <div class="ruler-track"><i class="fill"></i><i class="head"></i></div>
    <div class="ruler-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div></div>`;
}

// Шапка страницы: заголовок, подзаголовок и действия справа
export const pageHead = (title, lead = '', actions = '') =>
  `<header class="page-head"><div><h1>${esc(title)}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</div>${actions ? `<div class="row">${actions}</div>` : ''}</header>`;

export const stat = (l, v, s = '') => `<div class="stat"><div class="v">${v}</div><div class="l">${esc(l)}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;

export const loadingHtml = (msg = 'Загрузка…') => `<div class="loading"><div class="spinner"></div>${esc(msg)}</div>`;

export function errorHtml(e) {
  const msg = e?.message || String(e);
  const noKey = msg.startsWith('NO_KEY');
  const ai = /^AI|AI не настроен/.test(msg);
  return `<div class="error">${icon('alert')}<div>${esc(msg.replace(/^NO_KEY:\s*/, ''))}
    ${noKey || ai ? `<div style="margin-top:6px"><a href="#/settings">Открыть настройки</a></div>` : ''}</div></div>`;
}

export async function withLoading(el, msg, fn) {
  el.innerHTML = loadingHtml(msg);
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    el.innerHTML = errorHtml(e);
    return undefined;
  }
}

export const outBadge = (x) =>
  !x ? '' : x >= 3 ? `<span class="badge hot">×${x.toFixed(1)}</span>` : x >= 1.5 ? `<span class="badge up">×${x.toFixed(1)}</span>` : `<span class="badge">×${x.toFixed(1)}</span>`;

export const ytLink = (id) => `https://www.youtube.com/watch?v=${id}`;

/**
 * Таблица видео с сортировкой.
 * cols: массив ключей из COLS
 */
const COLS = {
  video: { t: 'Видео', html: (v) => `<div class="vcell"><img loading="lazy" src="${esc(v.thumb)}"><div><div class="tt">${esc(v.title)}</div><div class="muted small">${esc(v.channelTitle || '')} · ${timeAgo(v.publishedAt)}</div></div></div>` },
  views: { t: 'Просмотры', num: true, val: (v) => v.views, html: (v) => fmt(v.views) },
  vph: { t: 'В час', num: true, val: (v) => v.vph, html: (v) => fmt(v.vph) },
  eng: { t: 'Вовл.', num: true, val: (v) => v.eng, html: (v) => pct(v.eng) },
  out: { t: 'Аутлаер', num: true, val: (v) => v.out, html: (v) => outBadge(v.out) },
  subs: { t: 'Подписч.', num: true, val: (v) => v.subs, html: (v) => fmt(v.subs) },
  ratio: { t: 'Просм./подп.', num: true, val: (v) => v.ratio, html: (v) => outBadge(v.ratio) },
  dur: { t: 'Длит.', num: true, val: (v) => v.duration, html: (v) => dur(v.duration) },
  date: { t: 'Дата', num: true, val: (v) => new Date(v.publishedAt).getTime(), html: (v) => new Date(v.publishedAt).toLocaleDateString() },
};

export function videoTable(container, videos, cols = ['video', 'views', 'vph', 'eng'], onClick) {
  let sortKey = null, dir = -1;
  const draw = () => {
    const rows = sortKey ? [...videos].sort((a, b) => dir * ((COLS[sortKey].val(a) || 0) - (COLS[sortKey].val(b) || 0))) : videos;
    container.innerHTML = `<div class="table-wrap"><table><thead><tr>${cols
      .map((c) => `<th data-k="${c}" class="${COLS[c].num ? 'num' : ''}"${COLS[c].val ? ` tabindex="0" aria-sort="${sortKey === c ? (dir < 0 ? 'descending' : 'ascending') : 'none'}"` : ''}>${COLS[c].t}${sortKey === c ? (dir < 0 ? ' ▾' : ' ▴') : ''}</th>`)
      .join('')}<th></th></tr></thead><tbody>${rows
      .map((v) => `<tr class="click" data-id="${esc(v.id)}" tabindex="0">${cols.map((c) => `<td class="${COLS[c].num ? 'num' : ''}">${COLS[c].html(v)}</td>`).join('')}
        <td class="num"><a class="ext" href="${esc(ytLink(v.id))}" target="_blank" rel="noopener" title="Открыть на YouTube" aria-label="Открыть на YouTube">${icon('external', 14)}</a></td></tr>`)
      .join('')}</tbody></table></div>`;
    // сортировка и переход по строке — мышью и с клавиатуры (Enter / пробел)
    const onKey = (fn) => (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); fn(e); } };
    $$('th', container).forEach((th) => {
      const sort = () => {
        const k = th.dataset.k;
        if (!k || !COLS[k].val) return;
        if (sortKey === k) dir *= -1; else { sortKey = k; dir = -1; }
        draw();
        $(`th[data-k="${k}"]`, container)?.focus();
      };
      th.addEventListener('click', sort);
      th.addEventListener('keydown', onKey(sort));
    });
    $$('tr.click', container).forEach((tr) => {
      const open = () => (onClick || ((id) => go('video', { id })))(tr.dataset.id);
      tr.addEventListener('click', (e) => { if (!e.target.closest('a')) open(); });
      tr.addEventListener('keydown', onKey(open));
    });
  };
  draw();
}

export function chips(items, { onClick, copyAll } = {}) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="chips">${items.map((it, i) => `<button type="button" class="chip" data-i="${i}">${esc(it.text)}${it.count ? `<b>${esc(it.count)}</b>` : ''}</button>`).join('')}</div>
    ${copyAll ? `<div style="margin-top:10px"><button class="btn ghost sm">${icon('copy', 14)} Копировать все</button></div>` : ''}`;
  $$('.chip', wrap).forEach((c) => c.addEventListener('click', () => (onClick || ((t) => copy(t)))(items[+c.dataset.i].text)));
  if (copyAll) $('button', wrap).addEventListener('click', () => copy(items.map((i) => i.text).join(', ')));
  return wrap;
}

export function checklist(checks) {
  return `<ul class="checklist">${checks.map((c) => `<li class="${c.ok ? 'ok' : ''}">${icon(c.ok ? 'check' : 'x', 14)}<span>${esc(c.text)}</span></li>`).join('')}</ul>`;
}

// Простейший markdown → HTML (заголовки, жирный, списки остаются как текст с pre-wrap)
export function md(text) {
  return esc(text)
    .replace(/^#{1,4}\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function aiOutput(container, text) {
  container.innerHTML = `<div class="ai-out">${md(text)}</div>
    <div class="row" style="margin-top:8px"><button class="btn ghost sm" data-copy>${icon('copy', 14)} Копировать</button></div>`;
  $('[data-copy]', container).addEventListener('click', () => copy(text));
}

export function heatmap(map) {
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const hours = ['0–3', '3–6', '6–9', '9–12', '12–15', '15–18', '18–21', '21–24'];
  const max = Math.max(1, ...map.flat().filter(Boolean).map((c) => c.v));
  let html = `<div class="heat"><div class="h"></div>${hours.map((h) => `<div class="h">${h}</div>`).join('')}`;
  map.forEach((row, d) => {
    html += `<div class="h">${days[d]}</div>`;
    row.forEach((c) => {
      const a = c ? 0.15 + 0.85 * (c.v / max) : 0;
      html += `<div title="${c ? `${c.n} видео, ×${c.v.toFixed(2)} к медиане` : 'нет публикаций'}" style="background:${c ? `color-mix(in srgb, var(--accent) ${Math.round(a * 100)}%, transparent)` : 'var(--panel2)'}">${c ? c.n : ''}</div>`;
    });
  });
  return html + '</div><div class="muted small" style="margin-top:6px">Цифра — число видео, яркость — средняя эффективность относительно медианы. Время — ваш часовой пояс.</div>';
}

// Рендер формы по описанию полей
export function formFields(fields, values = {}) {
  return fields.map((f) => {
    const v = values[f.k] ?? f.def ?? '';
    const id = 'f_' + f.k;
    let input;
    if (f.type === 'textarea') input = `<textarea id="${id}" data-k="${f.k}">${esc(v)}</textarea>`;
    else if (f.type === 'select') input = `<select id="${id}" data-k="${f.k}">${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else input = `<input id="${id}" data-k="${f.k}" type="${f.type || 'text'}" value="${esc(v)}">`;
    return `<label for="${id}">${esc(f.label)}${f.req ? ' *' : ''}</label>${input}`;
  }).join('');
}

export const readForm = (root) => Object.fromEntries($$('[data-k]', root).map((el) => [el.dataset.k, el.value.trim()]));
