import { $, esc, fmt, pct, go, icon, toast, withLoading, videoTable, pageHead } from '../ui.js';
import { competitorsOverview } from '../../lib/analysis.js';
import { resolveChannelId } from '../../lib/youtube.js';
import { getData, setData, getSettings } from '../../lib/storage.js';

export async function render(root) {
  root.innerHTML = `<div class="v-competitors">
    ${pageHead('Конкуренты', 'Сравнение метрик каналов и лента их новых видео с отметкой аутлаеров.')}
    <form class="cp-form" id="f" aria-label="Добавить конкурента">
      <div class="search">${icon('users', 16)}<input id="q" aria-label="Канал конкурента" placeholder="@handle, ссылка или ID канала конкурента"></div>
      <button class="btn">${icon('plus', 15)} Добавить</button></form>
    <label class="check cp-mine-toggle"><input type="checkbox" id="withMine" checked> Показывать мой канал для сравнения</label>
    <div id="res"></div></div>`;
  $('#f', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#q', root).value.trim();
    if (!v) return;
    try {
      const id = await resolveChannelId(v);
      const list = await getData('competitors', []);
      if (!list.includes(id)) list.push(id);
      await setData('competitors', list);
      $('#q', root).value = '';
      toast('Канал добавлен');
      load(root);
    } catch (err) { toast(err.message, true); }
  });
  $('#withMine', root).addEventListener('change', () => load(root));
  await load(root);
}

async function load(root) {
  const res = $('#res', root);
  const list = await getData('competitors', []);
  const { myChannel } = await getSettings();
  const ids = [...list];
  if ($('#withMine', root).checked && myChannel && !ids.includes(myChannel)) ids.unshift(myChannel);
  if (!ids.length) {
    res.innerHTML = '<div class="empty">Добавьте каналы конкурентов, чтобы сравнивать метрики и видеть их новые видео с отметкой аутлаеров.</div>';
    return;
  }
  const data = await withLoading(res, 'Загружаю каналы…', () => competitorsOverview(ids, 15));
  if (!data) return;
  // мой канал — первой строкой; шкала медианы — относительно лучшего в таблице
  const rows = [...data.rows].sort((a, b) => (b.channel.id === myChannel) - (a.channel.id === myChannel));
  const maxMed = Math.max(1, ...rows.map((r) => r.stats.median || 0));
  res.innerHTML = `
    <div class="section-head"><h2>Сравнение</h2><span class="cp-note"><span class="mono">${rows.length}</span> ${rows.length === 1 ? 'канал' : rows.length < 5 ? 'канала' : 'каналов'} · последние 15 видео</span></div>
    <div class="table-wrap"><table class="cp-table"><thead><tr><th>Канал</th><th class="num">Подписчики</th><th class="num">Просмотры</th><th class="num">Видео</th>
    <th class="num">Медиана (15)</th><th class="num">Видео/нед</th><th class="num">Вовл.</th><th><span class="sr">Действия</span></th></tr></thead><tbody>
    ${rows.map(({ channel: c, stats: s }) => {
      const mine = c.id === myChannel;
      return `<tr class="click${mine ? ' cp-mine' : ''}" data-id="${esc(c.id)}">
      <td><div class="cp-ch"><img class="avatar" src="${esc(c.thumb)}" alt=""><a href="#/channel?q=${encodeURIComponent(c.id)}">${esc(c.title)}</a>${mine ? '<span class="badge up">мой</span>' : ''}</div></td>
      <td class="num">${fmt(c.subs)}</td><td class="num">${fmt(c.views)}</td><td class="num">${fmt(c.videos)}</td>
      <td class="num"><div class="cp-med">${fmt(s.median)}<i style="--w:${Math.round(((s.median || 0) / maxMed) * 100)}%"></i></div></td>
      <td class="num">${s.perWeek.toFixed(1)}</td><td class="num">${pct(s.avgEng)}</td>
      <td class="num">${mine ? '' : `<a href="#" class="ext" data-del="${esc(c.id)}" title="Убрать из конкурентов" aria-label="Убрать ${esc(c.title)} из конкурентов">${icon('x', 14)}</a>`}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    <div class="section-head"><h2>Лента новых видео</h2><span class="cp-note">×N — во сколько раз видео обгоняет медиану своего канала</span></div>
    <div id="feed"></div>`;
  res.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    go('channel', { q: tr.dataset.id });
  }));
  res.querySelectorAll('[data-del]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    await setData('competitors', (await getData('competitors', [])).filter((x) => x !== a.dataset.del));
    load(root);
  }));
  videoTable($('#feed', res), data.feed.slice(0, 60), ['video', 'views', 'vph', 'out', 'eng']);
}
