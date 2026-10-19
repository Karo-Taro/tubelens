import { $, esc, go, icon, withLoading, videoTable, pageHead } from '../ui.js';
import { mostPopular, CATEGORIES, REGIONS } from '../../lib/youtube.js';
import { outlierSearch } from '../../lib/analysis.js';
import { vph, engagement } from '../../lib/scoring.js';
import { getSettings } from '../../lib/storage.js';

const PERIODS = [['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней'], ['365', 'Год']];

export async function render(root, params) {
  const s = await getSettings();
  const mode = 'outliers';
  root.innerHTML = `<div class="v-trends">${pageHead('Аутлаеры', 'Видео, которые набрали намного больше просмотров, чем подписчиков у канала, — значит, тему разогнал алгоритм, а не аудитория автора.')}
    <div id="form"></div><div id="res"></div></div>`;
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => go('trends', { mode: b.dataset.mode })));

  const form = $('#form', root), res = $('#res', root);
  if (mode === 'trending') {
    const region = params.region || s.region, cat = params.cat || '';
    form.innerHTML = `<form class="tr-form" id="f">
      <select id="region" aria-label="Регион">${REGIONS.map((r) => `<option ${r === region ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <select id="cat" aria-label="Категория">${Object.entries(CATEGORIES).map(([id, n]) => `<option value="${id}" ${String(id) === String(cat) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <button class="btn">Показать</button></form>`;
    $('#f', form).addEventListener('submit', (e) => {
      e.preventDefault();
      go('trends', { mode, region: $('#region', form).value, cat: $('#cat', form).value });
    });
    const vids = await withLoading(res, 'Загружаю тренды…', () => mostPopular(region, cat));
    if (vids) videoTable(res, vids.map((v) => ({ ...v, vph: vph(v), eng: engagement(v) })), ['video', 'views', 'vph', 'eng', 'dur'], undefined, { csvName: 'tubelens-trending' });
    return;
  }

  const q = params.q || '';
  const days = params.days || '30';
  form.innerHTML = `<form class="tr-form" id="f" role="search">
      <div class="search">${icon('search', 16)}<input id="q" autocomplete="off" aria-label="Ниша или запрос" placeholder="Ниша или запрос, например: ремонт квартиры" value="${esc(q)}"></div>
      <div class="seg" role="group" aria-label="Период публикации">${PERIODS.map(([v, l]) => `<button type="button" data-days="${v}" class="${v === days ? 'on' : ''}" aria-pressed="${v === days}">${l}</button>`).join('')}</div>
      <input type="hidden" id="days" value="${days}">
      <button class="btn">Найти</button>
    </form>
    <p class="tr-note muted small">Поиск по 50 самым просматриваемым видео периода — около <span class="mono">102</span> ед. квоты API.</p>`;
  form.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
    form.querySelectorAll('[data-days]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    $('#days', form).value = b.dataset.days;
  }));
  $('#f', form).addEventListener('submit', (e) => {
    e.preventDefault();
    go('trends', { mode, q: $('#q', form).value.trim(), days: $('#days', form).value });
  });

  if (!q) {
    res.innerHTML = `<div class="tr-idle">
      <p>Укажите нишу — найдём видео, которые «выстрелили» сильнее своих каналов. Колонка <b>Просм./подп.</b> показывает, во сколько раз просмотры превысили число подписчиков:</p>
      <dl class="tr-legend">
        <div><dt><span class="badge">×1.0</span></dt><dd>на уровне аудитории канала</dd></div>
        <div><dt><span class="badge up">×1.5</span></dt><dd>заметно выше — тема работает</dd></div>
        <div><dt><span class="badge hot">×3.0</span></dt><dd>выстрелило — алгоритм вывел к новым зрителям</dd></div>
      </dl></div>`;
    return;
  }
  const label = (PERIODS.find(([v]) => v === days)?.[1] || `${days} дн.`).toLowerCase();
  const vids = await withLoading(res, 'Ищу аутлаеры…', () => outlierSearch(q, +days));
  if (!vids) return;
  if (!vids.length) {
    res.innerHTML = `<div class="empty">По запросу «${esc(q)}» за ${label} нет видео с заметным числом просмотров. Попробуйте период длиннее или более широкую формулировку.</div>`;
    return;
  }
  const hot = vids.filter((v) => v.ratio >= 3).length;
  res.innerHTML = `<div class="section-head"><h2>«${esc(q)}» · ${label}</h2><span class="muted small mono">${vids.length} видео${hot ? ` · ${hot} ×3+` : ''}</span></div><div id="tbl"></div>`;
  videoTable($('#tbl', res), vids, ['video', 'views', 'subs', 'ratio', 'vph', 'eng'], undefined, { csvName: 'tubelens-outliers' });
}
