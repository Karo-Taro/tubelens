import { $, esc, fmt, pct, dur, stat, go, icon, toast, videoTable, loadingHtml, errorHtml, aiOutput, pageHead } from '../ui.js';
import { channelAudit, channelContext } from '../../lib/analysis.js';
import { getData, setData, saveSettings, getSettings, pushRecent } from '../../lib/storage.js';
import { ask } from '../../lib/ai.js';
import { SYSTEM, toolById } from '../../lib/prompts.js';

const form = (q, compact) => `<form class="ch-form${compact ? ' compact' : ''}" id="f" aria-label="Аудит другого канала">
    <div class="search">${icon('search', 16)}<input id="q" aria-label="Канал" placeholder="${compact ? 'Другой канал: @handle, ссылка или ID' : '@handle, ссылка или ID канала'}" value="${esc(q)}"></div>
    <select id="n" aria-label="Сколько видео анализировать"><option value="50">50 видео</option><option value="100">100 видео</option><option value="200">200 видео</option></select>
    <button class="btn${compact ? ' ghost' : ''}">${compact ? 'Проверить' : 'Проверить канал'}</button></form>`;

export async function render(root, params) {
  const s = await getSettings();
  const q = params.q || '';
  root.innerHTML = `<div class="v-channel">
    ${q ? form(q, true) : pageHead('Аудит канала', 'Статистика последних видео, лучшее время публикации и что улучшить.', s.myChannel ? `<button class="btn ghost" id="mine">${icon('star', 15)} Аудит моего канала</button>` : '') + form(q, false)}
    <div id="res"></div></div>`;
  $('#n', root).value = params.n || '50';
  $('#f', root).addEventListener('submit', (e) => {
    e.preventDefault();
    go('channel', { q: $('#q', root).value.trim(), n: $('#n', root).value });
  });
  $('#mine', root)?.addEventListener('click', () => go('channel', { q: s.myChannel }));
  if (q) await audit($('#res', root), q, +params.n || 50);
}

// Тепловая карта «когда публиковать» в цветах темы: яркость — эффективность к медиане, цифра — число видео
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HOURS = ['0–3', '3–6', '6–9', '9–12', '12–15', '15–18', '18–21', '21–24'];
// ступени яркости — эффективность относительно медианы канала (×1 = как обычно)
const STEPS = [{ to: 0.5, t: '<0.5' }, { to: 1, t: '0.5–1' }, { to: 1.5, t: '1–1.5' }, { to: 2.5, t: '1.5–2.5' }, { to: Infinity, t: '2.5+' }];
function heat(map) {
  const cells = map.flatMap((row, d) => row.map((c, h) => (c ? { ...c, d, h } : null))).filter(Boolean);
  // лучшее окно — по эффективности, но только там, где было больше одной публикации (если такие есть)
  const pool = cells.some((c) => c.n > 1) ? cells.filter((c) => c.n > 1) : cells;
  const best = pool.sort((a, b) => b.v - a.v)[0];
  const step = (v) => STEPS.findIndex((x) => v < x.to);
  let html = `<div class="ch-heat" role="table" aria-label="Эффективность публикаций по дням и часам"><div class="h"></div>${HOURS.map((h) => `<div class="h" role="columnheader">${h}</div>`).join('')}`;
  map.forEach((row, d) => {
    html += `<div class="h" role="rowheader">${DAYS[d]}</div>`;
    row.forEach((c, h) => {
      html += c
        ? `<div role="cell" class="q${step(c.v)}${best && best.d === d && best.h === h ? ' best' : ''}" title="${DAYS[d]} ${HOURS[h]}: ${c.n} видео, ×${c.v.toFixed(2)} к медиане">${c.n}</div>`
        : `<div role="cell" class="e" title="${DAYS[d]} ${HOURS[h]}: нет публикаций"></div>`;
    });
  });
  html += `</div><div class="ch-legend">
    <span class="ch-scale"><span class="muted">к медиане, ×</span>${STEPS.map((x, i) => `<span><i class="q${i}"></i><span class="mono">${x.t}</span></span>`).join('')}</span>
    <span><i class="e"></i> нет публикаций</span><span><i class="best"></i> лучшее окно</span></div>
    <p class="ch-note">${best ? `Лучшее окно — <b>${DAYS[best.d]}, ${HOURS[best.h]}</b>: <span class="mono">×${best.v.toFixed(2)}</span> к медиане по ${best.n} видео. ` : ''}Цифра в ячейке — число видео. Время — ваш часовой пояс.</p>`;
  return html;
}

const section = (title, note = '') => `<div class="section-head"><h2>${title}</h2>${note ? `<span class="ch-note-inline">${note}</span>` : ''}</div>`;

async function audit(res, q, n) {
  res.innerHTML = `<div class="ch-head" aria-busy="true"><div class="ch-ava skeleton"></div><div class="grow"><div class="skeleton" style="height:12px;width:96px"></div>
    <div class="skeleton" style="height:28px;width:55%;margin-top:12px"></div></div></div>${loadingHtml('Собираю данные канала…')}`;
  let a;
  try { a = await channelAudit(q, n); } catch (e) {
    console.error(e);
    res.innerHTML = pageHead('Аудит канала') + errorHtml(e);
    return;
  }
  const c = a.channel;
  pushRecent({ type: 'channel', key: c.id, title: c.title, thumb: c.thumb, sub: c.handle });
  const meta = [c.handle && esc(c.handle), c.country && esc(c.country), c.publishedAt && 'с ' + new Date(c.publishedAt).getFullYear()].filter(Boolean).join(' · ');
  const hero = (l, v, s = '') => `<div class="ch-hero"><div class="hero-num">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;

  res.innerHTML = `
    <header class="ch-head">
      <img class="ch-ava" src="${esc(c.thumb)}" alt="">
      <div class="ch-id"><div class="eyebrow">Аудит канала</div><h1>${esc(c.title)}</h1>${meta ? `<div class="ch-meta mono">${meta}</div>` : ''}</div>
      <div class="ch-actions">
        <button class="btn ghost sm" id="setMine">${icon('star', 14)} Это мой канал</button>
        <button class="btn ghost sm" id="addComp">${icon('plus', 14)} В конкуренты</button>
        <a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.youtube.com/channel/${esc(c.id)}">${icon('external', 14)} YouTube</a>
      </div>
    </header>

    <section class="ch-heroes" aria-label="Главные показатели">
      ${hero('Подписчики', c.hiddenSubs ? 'скрыто' : (c.subsApprox ? '≈' : '') + fmt(c.subs))}
      ${hero('Медиана просмотров', fmt(a.median), `по ${a.videos.length} видео`)}
      ${hero('Видео в неделю', a.perWeek.toFixed(1))}
    </section>
    <section class="ch-band" aria-label="Показатели канала">
      ${stat('Всего просмотров', fmt(c.views))}${stat('Видео', fmt(c.videos))}${stat('Средн. последних 10', fmt(a.recentAvg))}
      ${stat('Вовлечённость', pct(a.avgEng))}${stat('Средняя длительность', dur(a.avgDuration))}
      ${stat('Доля Shorts', pct(a.shortsShare * 100, 0))}${stat('Медиана / подписчики', pct(a.viewsPerSub * 100))}
    </section>

    <div class="ch-cols">
      <section>
        ${section('Рекомендации', a.tips.length ? `<span class="mono">${a.tips.length}</span>` : '')}
        ${a.tips.length ? `<ul class="ch-tips">${a.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">Явных проблем не найдено.</p>'}
        <button class="btn" id="aiAudit">${icon('sparkles', 15)} Подробный AI-аудит</button>
      </section>
      <section>
        ${section('Когда публиковать')}
        ${heat(a.heatMap)}
      </section>
    </div>
    <div id="aiOut"></div>

    ${a.outliers.length ? `${section('Аутлаеры', '×2 и выше к медиане')}<div id="outs"></div>` : ''}
    ${section('Топ видео', 'по просмотрам')}<div id="top"></div>
    ${section('Все загруженные', `<span class="mono">${a.videos.length}</span>`)}<div id="all"></div>`;

  if (a.outliers.length) videoTable($('#outs', res), a.outliers, ['video', 'views', 'out', 'vph', 'eng'], undefined, { csvName: 'tubelens-channel-outliers' });
  videoTable($('#top', res), a.top, ['video', 'views', 'out', 'eng'], undefined, { csvName: 'tubelens-channel-top' });
  videoTable($('#all', res), a.videos, ['video', 'date', 'views', 'vph', 'eng', 'out', 'dur'], undefined, { csvName: 'tubelens-channel-videos' });

  $('#setMine', res).addEventListener('click', async () => { await saveSettings({ myChannel: c.id }); toast('Сохранено как ваш канал'); });
  $('#addComp', res).addEventListener('click', async () => {
    const list = await getData('competitors', []);
    if (!list.includes(c.id)) list.push(c.id);
    await setData('competitors', list);
    toast('Добавлено в конкуренты');
  });
  $('#aiAudit', res).addEventListener('click', async () => {
    const out = $('#aiOut', res);
    out.innerHTML = `${section('AI-аудит')}<div class="ch-ai">${loadingHtml('AI анализирует канал…')}</div>`;
    const box = out.querySelector('.ch-ai');
    try {
      aiOutput(box, await ask(toolById('channelAudit').prompt({ context: channelContext(a) + '\nСоветы эвристик: ' + a.tips.join(' ') }), SYSTEM));
    } catch (e) { box.innerHTML = errorHtml(e); }
  });
}
