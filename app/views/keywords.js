import { $, esc, fmt, stat, gauge, go, icon, toast, withLoading, videoTable, chips, loadingHtml, errorHtml, aiOutput, pageHead, scoreClass } from '../ui.js';
import { keywordReport } from '../../lib/analysis.js';
import { suggest, suggestDeep } from '../../lib/youtube.js';
import { getData, setData, pushRecent } from '../../lib/storage.js';
import { ask } from '../../lib/ai.js';
import { SYSTEM } from '../../lib/prompts.js';

export async function render(root, params) {
  root.innerHTML = `<div class="v-keywords">${pageHead('Ключевые слова', 'Насколько запрос востребован и насколько сильные каналы занимают топ выдачи.')}
    <form class="kw-form" id="f" role="search">
      <div class="search">${icon('search', 16)}<input id="q" autocomplete="off" aria-label="Поисковый запрос" placeholder="Например: как монтировать видео" value="${esc(params.q || '')}"></div>
      <button class="btn">Оценить запрос</button>
    </form>
    <p class="kw-note muted small">Полный анализ — около <span class="mono">102</span> ед. квоты API. Подсказки при вводе — бесплатно и без ключа.</p>
    <div id="live" class="kw-live" aria-live="polite"></div>
    <div id="res"></div><div id="saved"></div>
    ${params.q ? '' : `<div id="idle" class="empty kw-idle"><p>Введите запрос — покажем спрос, конкуренцию, связанные запросы, теги и топ выдачи.</p></div>`}</div>`;
  const q = $('#q', root);
  $('#f', root).addEventListener('submit', (e) => {
    e.preventDefault();
    if (q.value.trim()) go('keywords', { q: q.value.trim() });
  });

  // Живые подсказки по мере ввода
  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const v = q.value.trim();
      const live = $('#live', root);
      if (!v) return (live.innerHTML = '');
      const list = await suggest(v).catch(() => []);
      live.innerHTML = '';
      if (list.length) {
        live.insertAdjacentHTML('beforeend', '<div class="eyebrow">Подсказки YouTube</div>');
        live.append(chips(list.map((text) => ({ text })), { onClick: (x) => go('keywords', { q: x }) }));
      }
    }, 300);
  });

  await renderSaved(root);
  if (params.q) await analyze(root, params.q);
}

const scoreCell = (v, inverse = false) => `<td class="num"><span class="kw-sc ${scoreClass(v, inverse)}">${v}</span></td>`;

async function renderSaved(root) {
  const saved = await getData('savedKeywords', []);
  const el = $('#saved', root);
  if (!saved.length) return (el.innerHTML = '');
  $('#idle', root)?.remove();
  el.innerHTML = `<div class="section-head"><h2>Сохранённые запросы</h2><span class="muted small mono">${saved.length}</span></div>
    <div class="table-wrap kw-saved"><table><thead><tr><th>Запрос</th><th class="num">Оценка</th><th class="num">Спрос</th><th class="num">Конкур.</th><th class="num">Дата</th><th><span class="sr">Удалить</span></th></tr></thead><tbody>
    ${saved.map((k, i) => `<tr class="click" data-q="${esc(k.q)}" tabindex="0"><td class="kw-saved-q">${esc(k.q)}</td>${scoreCell(k.overall)}${scoreCell(k.volume)}${scoreCell(k.competition, true)}
      <td class="num muted">${new Date(k.at).toLocaleDateString()}</td><td class="num"><a href="#" class="ext" data-del="${i}" title="Удалить" aria-label="Удалить «${esc(k.q)}»">${icon('x', 14)}</a></td></tr>`).join('')}</tbody></table></div>`;
  el.querySelectorAll('tr[data-q]').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      go('keywords', { q: tr.dataset.q });
    });
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === tr) go('keywords', { q: tr.dataset.q }); });
  });
  el.querySelectorAll('[data-del]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    saved.splice(+a.dataset.del, 1);
    await setData('savedKeywords', saved);
    renderSaved(root);
  }));
}

async function analyze(root, q) {
  const res = $('#res', root);
  const r = await withLoading(res, `Анализирую «${q}»…`, () => keywordReport(q));
  if (!r) return;
  const s = r.score;
  pushRecent({ type: 'keyword', key: q, title: q, sub: `оценка ${s.overall}` });
  res.innerHTML = `
    <section class="kw-result" aria-labelledby="kwQ">
      <header class="kw-head">
        <div class="kw-title"><div class="eyebrow">Запрос</div><h2 id="kwQ">${esc(q)}</h2></div>
        <div class="row"><button class="btn ghost sm" id="save">${icon('star', 14)} Сохранить</button>
          <button class="btn sm" id="toTitles">${icon('sparkles', 14)} Заголовки под запрос</button></div>
      </header>
      <div class="meters">${gauge(s.overall, 'Общая оценка')}${gauge(s.volume, 'Спрос')}${gauge(s.competition, 'Конкуренция', true)}</div>
    </section>
    <div class="grid kw-stats">
      ${stat('Медиана просмотров', fmt(s.medViews), 'топ-10 выдачи')}${stat('Медиана подписчиков', fmt(s.medSubs), 'каналы топ-10')}
      ${stat('Точное вхождение', s.titleMatch + '%', 'фраза в заголовке')}${stat('Свежие', s.fresh + '%', 'моложе 90 дней')}${stat('Средний VPH', fmt(s.avgVph), 'просмотров в час')}
    </div>
    ${s.insights.length ? `<div class="section-head"><h2>Выводы</h2></div><ul class="kw-insights">${s.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    <div class="kw-cols">
      <section>
        <div class="section-head"><h2>Связанные запросы</h2></div>
        <div class="row kw-tools"><button class="btn ghost sm" id="deep">Расширить А–Я</button><button class="btn ghost sm" id="aiKw">${icon('sparkles', 14)} AI-идеи</button></div>
        <div id="rel"></div><div id="aiKwOut" class="kw-ai"></div>
      </section>
      <section>
        <div class="section-head"><h2>Теги в топе</h2>${r.tags.length ? `<span class="muted small mono">${r.tags.length}</span>` : ''}</div>
        <div id="tags"></div>
      </section>
    </div>
    <div class="section-head"><h2>Топ выдачи</h2><span class="muted small mono">${r.videos.length}</span></div><div id="top"></div>`;

  const relEl = $('#rel', res);
  const showRel = (list) => {
    relEl.innerHTML = '';
    if (list.length) relEl.append(chips(list.map((text) => ({ text })), { onClick: (x) => go('keywords', { q: x }), copyAll: true }));
    else relEl.innerHTML = '<p class="muted small">YouTube не дал подсказок для этого запроса.</p>';
  };
  showRel(r.suggestions);
  const tagsEl = $('#tags', res);
  if (r.tags.length) tagsEl.append(chips(r.tags.map((t) => ({ text: t.tag, count: t.count })), { copyAll: true }));
  else tagsEl.innerHTML = '<p class="muted small">У видео в топе нет открытых тегов.</p>';
  videoTable($('#top', res), r.videos, ['video', 'views', 'vph', 'subs', 'eng'], undefined, { csvName: 'tubelens-keyword-top' });

  $('#deep', res).addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    relEl.innerHTML = loadingHtml('Собираю подсказки…');
    showRel(await suggestDeep(q));
  });
  $('#aiKw', res).addEventListener('click', async () => {
    const out = $('#aiKwOut', res);
    out.innerHTML = loadingHtml('AI думает…');
    try {
      aiOutput(out, await ask(
        `Ключевой запрос YouTube: «${q}». Подсказки YouTube: ${r.suggestions.join('; ')}. Частые теги топа: ${r.tags.slice(0, 20).map((t) => t.tag).join(', ')}.\n` +
          'Предложи 20 ключевых запросов длинного хвоста с низкой конкуренцией, сгруппируй по намерению зрителя, и 5 идей видео под лучшие из них.',
        SYSTEM
      ));
    } catch (e) { out.innerHTML = errorHtml(e); }
  });
  $('#toTitles', res).addEventListener('click', () => go('ai', { tool: 'titles', keyword: q, topic: q }));
  $('#save', res).addEventListener('click', async () => {
    const saved = (await getData('savedKeywords', [])).filter((k) => k.q !== q);
    saved.unshift({ q, overall: s.overall, volume: s.volume, competition: s.competition, at: Date.now() });
    await setData('savedKeywords', saved.slice(0, 200));
    toast('Сохранено');
    renderSaved(root);
  });
}
