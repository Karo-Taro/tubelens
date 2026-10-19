import { $, esc, fmt, pct, dur, stat, gauge, go, bg, icon, toast, timeAgo, chips, checklist, loadingHtml, errorHtml, aiOutput, pageHead, ytLink } from '../ui.js';
import { videoReport, rankCheck } from '../../lib/analysis.js';
import { pushRecent } from '../../lib/storage.js';
import { parseVideoId, topComments } from '../../lib/youtube.js';
import { ask } from '../../lib/ai.js';
import { SYSTEM, toolById } from '../../lib/prompts.js';

// Форма «другое видео». Без отчёта — главный элемент страницы, с отчётом — тонкая строка над ним.
const form = (params, compact) => `<form id="f" class="vr-form${compact ? ' compact' : ''}" aria-label="Анализ другого видео">
    <div class="search vr-url">${icon('play', 16)}<input id="u" aria-label="Ссылка на видео или ID" placeholder="${compact ? 'Другое видео: ссылка или ID' : 'Ссылка на видео или ID'}" value="${esc(params.id || '')}"></div>
    <input id="kw" class="vr-kw" aria-label="Целевая ключевая фраза" value="${esc(params.kw || '')}" placeholder="Ключевая фраза (по умолчанию — первый тег)">
    <button class="btn${compact ? ' ghost' : ''}">${compact ? 'Проверить' : 'Анализ'}</button></form>`;

// Заглушка-скелет отчёта на время загрузки
const skeleton = `<div class="vr-head" aria-busy="true"><div class="vr-thumb skeleton"></div>
  <div class="vr-meta"><div class="skeleton" style="height:12px;width:96px"></div><div class="skeleton" style="height:26px;width:90%;margin-top:12px"></div>
  <div class="skeleton" style="height:26px;width:60%;margin-top:8px"></div><div class="skeleton" style="height:14px;width:45%;margin-top:16px"></div></div></div>
  ${loadingHtml('Загружаю видео…')}`;

export async function render(root, params) {
  root.innerHTML = `<div class="v-video">
    ${params.id ? form(params, true) : pageHead('Анализ видео', 'SEO-оценка, метрики относительно канала, теги, позиция в поиске и AI-оптимизация.') + form(params, false)}
    <div id="res"></div></div>`;
  $('#f', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const id = parseVideoId($('#u', root).value);
    if (!id) return ($('#res', root).innerHTML = errorHtml(new Error('Не удалось распознать ID видео')));
    go('video', { id, kw: $('#kw', root).value.trim() });
  });
  if (params.id) await analyze($('#res', root), params.id, params.kw);
}

const outClass = (x) => (x >= 3 ? 'hot' : x >= 1.5 ? 'good' : x < 0.5 ? 'bad' : '');

async function analyze(res, id, kw) {
  res.innerHTML = skeleton;
  let r;
  try { r = await videoReport(id, kw); } catch (e) {
    console.error(e);
    res.innerHTML = `<div class="vr-err">${pageHead('Анализ видео')}${errorHtml(e)}</div>`;
    return;
  }
  const v = r.video, c = r.channel;
  pushRecent({ type: 'video', key: v.id, title: v.title, thumb: v.thumb, sub: v.channelTitle });
  const checks = [...r.seo.checks].sort((a, b) => a.ok - b.ok);
  const passed = checks.filter((x) => x.ok).length;
  const tagsLen = v.tags.join(',').length;

  res.innerHTML = `
    <header class="vr-head">
      <a class="vr-thumb" href="${esc(ytLink(v.id))}" target="_blank" rel="noopener" aria-label="Открыть видео на YouTube">
        <img src="${esc(v.thumbHi || v.thumb)}" alt="">${v.duration ? `<span class="vr-dur">${dur(v.duration)}</span>` : ''}</a>
      <div class="vr-meta">
        <div class="eyebrow">Анализ видео</div>
        <h1${v.title.length > 60 ? ' class="long"' : ''}>${esc(v.title)}</h1>
        <div class="vr-ch">${c?.thumb ? `<img class="avatar" src="${esc(c.thumb)}" alt="">` : ''}<span><b>${esc(v.channelTitle)}</b>
          <span class="muted">${c ? ` · <span class="mono">${fmt(c.subs)}</span> подписчиков` : ''} · ${timeAgo(v.publishedAt)}</span></span></div>
        <div class="vr-actions">
          <button class="btn" id="opt">${icon('sparkles', 15)} AI-оптимизация</button>
          ${r.hasKey ? `<button class="btn ghost" id="cmt">${icon('message', 15)} Анализ комментариев</button>` : ''}
          <span class="vr-sec">
            ${c ? `<button class="btn ghost sm" id="ch">${icon('chart', 14)} Аудит канала</button>` : ''}
            <button class="btn ghost sm" id="dl">${icon('download', 14)} Скачать</button>
            <button class="btn ghost sm" id="th">${icon('image', 14)} Обложка</button>
          </span>
        </div>
      </div>
    </header>

    <section class="vr-band" aria-label="Ключевые показатели">
      <div class="vr-gauge">${gauge(r.seo.score, 'SEO-оценка')}</div>
      <div class="vr-stats">
        ${stat('Просмотры', fmt(v.views))}${stat('В час', fmt(v.vph), 'VPH')}${stat('Лайки', fmt(v.likes))}
        ${stat('Комментарии', fmt(v.comments))}${stat('Вовлечённость', pct(v.eng))}
        ${v.out ? stat('Аутлаер', `<span class="${outClass(v.out)}">×${v.out.toFixed(1)}</span>`, `к медиане ${fmt(r.channelMedian)}`) : ''}
      </div>
    </section>

    <div id="aiOut"></div>

    <div class="section-head"><h2>SEO-чеклист</h2><span class="vr-note"><span class="mono">${passed}/${checks.length}</span>${r.seo.keyword ? ` · фраза «${esc(r.seo.keyword)}»` : ''}</span></div>
    ${checklist(checks)}

    <div class="section-head"><h2>Теги</h2><span class="vr-note mono">${v.tags.length} · ${tagsLen}/500 симв.</span></div>
    <div id="tags"></div>

    <div class="vr-cols">
      <section>
        <div class="section-head"><h2>Позиция в поиске</h2></div>
        <form class="vr-rank" id="rankF"><input id="rq" aria-label="Поисковый запрос" placeholder="Поисковый запрос" value="${esc(r.seo.keyword || '')}"><button class="btn ghost" id="rank">Проверить</button></form>
        <div id="rankOut" class="vr-rank-out" aria-live="polite"><span class="muted small">Ищем видео в топ-50 выдачи по запросу.</span></div>
      </section>
      <section>
        <div class="section-head"><h2>Описание</h2><span class="vr-note mono">${v.description.length} симв.</span></div>
        <div class="vr-desc">${esc(v.description) || '<span class="muted">Пусто</span>'}</div>
      </section>
    </div>`;

  $('#tags', res).append(v.tags.length ? chips(v.tags.map((text) => ({ text })), { copyAll: true }) : Object.assign(document.createElement('div'), { className: 'muted', textContent: 'Теги скрыты или отсутствуют' }));
  if (c) $('#ch', res).addEventListener('click', () => go('channel', { q: c.id }));
  $('#dl', res).addEventListener('click', () => go('downloads', { url: ytLink(v.id), title: v.title }));
  $('#th', res).addEventListener('click', () => bg('thumb', { id: v.id, title: v.title }).then(() => toast('Обложка скачивается'), (e) => toast(e.message, true)));

  const aiBlock = (title) => {
    const out = $('#aiOut', res);
    out.innerHTML = `<div class="section-head"><h2>${esc(title)}</h2></div><div class="vr-ai"></div>`;
    return out.querySelector('.vr-ai');
  };

  $('#opt', res).addEventListener('click', async () => {
    const box = aiBlock('AI-оптимизация');
    box.innerHTML = loadingHtml('AI оптимизирует…');
    const tool = toolById('optimize');
    const stats = `просмотры ${v.views}, VPH ${Math.round(v.vph)}, вовлечённость ${v.eng == null ? 'н/д' : v.eng.toFixed(2) + '%'}, SEO ${r.seo.score}/100, ` +
      `провалено: ${r.seo.checks.filter((x) => !x.ok).map((x) => x.text).join('; ')}`;
    try {
      const text = await ask(tool.prompt({ title: v.title, description: v.description.slice(0, 3000), tags: v.tags.join(', '), keyword: kw, stats }), SYSTEM);
      aiOutput(box, text);
    } catch (e) { box.innerHTML = errorHtml(e); }
  });

  $('#cmt', res)?.addEventListener('click', async () => {
    const box = aiBlock('Анализ комментариев');
    box.innerHTML = loadingHtml('Читаю комментарии…');
    try {
      const comments = await topComments(v.id, 60);
      if (!comments.length) throw new Error('Комментарии недоступны');
      const text = await ask(
        `Видео: «${v.title}». Топ комментарии зрителей:\n${comments.map((x) => `- (${x.likes} лайков) ${x.text.slice(0, 300)}`).join('\n')}\n\n` +
          'Проанализируй: общее настроение; что понравилось; критика; вопросы зрителей; 5 идей следующих видео на основе запросов аудитории.',
        SYSTEM
      );
      aiOutput(box, text);
    } catch (e) { box.innerHTML = errorHtml(e); }
  });

  $('#rankF', res).addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#rq', res).value.trim();
    if (!q) return;
    const o = $('#rankOut', res);
    o.innerHTML = loadingHtml('Ищу…');
    try {
      const pos = await rankCheck(v.id, q);
      o.innerHTML = pos
        ? `<span class="vr-pos ${pos <= 10 ? 'good' : pos <= 30 ? 'mid' : ''}">#${pos}</span><span>по запросу «${esc(q)}»<br><span class="muted small">${pos <= 10 ? 'первая страница выдачи' : 'из топ-50'}</span></span>`
        : `<span class="vr-pos muted">—</span><span>Не найдено в топ-50 по запросу «${esc(q)}»</span>`;
    } catch (err) { o.innerHTML = errorHtml(err); }
  });
}
