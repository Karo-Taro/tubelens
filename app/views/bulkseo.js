// SEO моего канала: массовая SEO-проверка последних видео своего канала (аналог vidIQ «Optimize»).
// Без ключа API: список загрузок — channelPage, данные каждого видео — videoDetails (InnerTube).
import * as ui from '../ui.js';
import { $, $$, esc, fmt, timeAgo, go, icon, toast, gauge, stat, pageHead, errorHtml, scoreClass, checklist } from '../ui.js';
import { getSettings, saveSettings, getData, setData } from '../../lib/storage.js';
import { resolveChannelId } from '../../lib/youtube.js';
import { channelPage, videoDetails } from '../../lib/innertube.js';
import { videoSeo } from '../../lib/scoring.js';

const SIZES = [30, 60, 120];
const CONCURRENCY = 4;
const cacheKey = (id) => 'bulkseo:' + id;

/* ---------- проблемы: стабильный ключ проверки, короткая формулировка, совет ---------- */
// easy — правится в YouTube Studio за минуту (без переписывания заголовка)
const PROBLEMS = [
  { k: 'title', re: /^Длина заголовка/, short: 'Длина заголовка вне 20–70' },
  { k: 'kwTitle', re: /^Ключевая фраза в заголовке/, short: 'Нет ключа в заголовке' },
  { k: 'kwStart', re: /^Ключевая фраза в начале/, short: 'Ключ не в начале заголовка' },
  { k: 'desc', re: /^Описание от/, short: 'Короткое описание', easy: 'Допишите описание до 250+ символов: о чём видео, для кого, ссылки.' },
  { k: 'kwDesc', re: /^Ключевая фраза в первых/, short: 'Нет ключа в начале описания', easy: 'Вставьте ключевую фразу в первые 1–2 предложения описания.' },
  { k: 'tags', re: /^5–30 тегов/, short: 'Нужно 5–30 тегов', easy: 'Добавьте 10–20 тегов: ключевая фраза, синонимы, длинный хвост.' },
  { k: 'tagsLen', re: /^Теги занимают/, short: 'Теги короче 150 символов', easy: 'Расширьте теги до 150–500 символов уточняющими фразами.' },
  { k: 'kwTags', re: /^Ключевая фраза в тегах/, short: 'Нет ключа в тегах', easy: 'Поставьте ключевую фразу первым тегом.' },
  { k: 'stamps', re: /^Таймкоды/, short: 'Нет таймкодов', easy: 'Добавьте 3+ таймкода (0:00 Вступление …) — YouTube покажет главы.' },
  { k: 'hashtags', re: /^Хэштеги/, short: 'Нет хэштегов (1–15)', easy: 'Добавьте 2–3 хэштега в конец описания.' },
  { k: 'links', re: /^Ссылки/, short: 'Нет ссылок и CTA', easy: 'Добавьте ссылки и призыв к действию в описание.' },
  { k: 'caption', re: /^Субтитры/, short: 'Нет субтитров', easy: 'Загрузите или проверьте автосубтитры в Студии.' },
  { k: 'hd', re: /^HD/, short: 'Не HD' },
  { k: 'caps', re: /КАПСОМ/, short: 'Заголовок капсом' },
];
const baseText = (t) => String(t || '').replace(/\s*\(сейчас[^)]*\)\s*$/, '');
export function problemOf(text) {
  const b = baseText(text);
  return PROBLEMS.find((p) => p.re.test(b)) || { k: b, short: b };
}

// Сколько баллов из 100 даёт проверка конкретному видео (вес / сумма весов его проверок)
const points = (checks, c) => (c.weight / (checks.reduce((s, x) => s + x.weight, 0) || 1)) * 100;

// Потенциал: просмотры × недобор SEO — с чего выгоднее всего начать
export const potential = (r) => (r.views || 0) * (100 - r.score);

/* ---------- данные ---------- */
function compact(v) {
  const seo = videoSeo(v);
  return {
    id: v.id, title: v.title, thumb: v.thumb, views: v.views || 0, publishedAt: v.publishedAt, duration: v.duration || 0,
    tags: (v.tags || []).length, keyword: seo.keyword, score: seo.score, checks: seo.checks,
  };
}

/**
 * Проверка последних n видео канала.
 * onProgress(done, total, channel) — после каждого видео; shouldStop() — отмена (новые видео не берутся).
 */
export async function scanChannel(channelId, n, { onProgress, shouldStop, concurrency = CONCURRENCY } = {}) {
  const t0 = Date.now();
  const { channel, videos } = await channelPage(channelId, n);
  const list = videos.filter((v) => !v.live).slice(0, n);
  const out = new Array(list.length).fill(null);
  let next = 0, done = 0, failed = 0;
  onProgress?.(0, list.length, channel);
  const worker = async () => {
    while (next < list.length && !shouldStop?.()) {
      const i = next++;
      try {
        const d = await videoDetails(list[i].id);
        if (!d.live) out[i] = compact({ ...list[i], ...d, thumb: list[i].thumb || d.thumb });
      } catch { failed++; }
      done++;
      onProgress?.(done, list.length, channel);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return {
    channel: { id: channel.id, title: channel.title, handle: channel.handle, thumb: channel.thumb },
    results: out.filter(Boolean),
    total: list.length, failed, stopped: done < list.length, n, at: Date.now(), ms: Date.now() - t0,
  };
}

// Сводка: средняя оценка, распределение, частые проблемы, быстрые победы
export function summarize(results) {
  const N = results.length;
  const avgScore = N ? results.reduce((s, r) => s + r.score, 0) / N : 0;
  const bands = [
    { t: '80–100', c: 'top', n: 0, test: (s) => s >= 80 },
    { t: '60–79', c: 'good', n: 0, test: (s) => s >= 60 && s < 80 },
    { t: '40–59', c: 'mid', n: 0, test: (s) => s >= 40 && s < 60 },
    { t: '0–39', c: 'bad', n: 0, test: (s) => s < 40 },
  ];
  for (const r of results) bands.find((b) => b.test(r.score)).n++;
  const pm = new Map();
  for (const r of results) {
    for (const c of r.checks) {
      const p = problemOf(c.text);
      const e = pm.get(p.k) || pm.set(p.k, { ...p, fail: 0, of: 0, gain: 0 }).get(p.k);
      e.of++;
      if (!c.ok) { e.fail++; e.gain += points(r.checks, c); }
    }
  }
  const problems = [...pm.values()].filter((p) => p.fail).sort((a, b) => b.fail - a.fail || b.gain - a.gain);
  // быстрые победы: простые правки описания/тегов, больше всего баллов в среднем по каналу
  const wins = problems.filter((p) => p.easy).map((p) => ({ ...p, avgGain: p.gain / N })).sort((a, b) => b.avgGain - a.avgGain).slice(0, 3);
  return {
    N, avgScore, bands, problems, wins,
    noTags: results.filter((r) => !r.tags).length,
    noStamps: results.filter((r) => failed(r, 'stamps')).length,
  };
}

const failed = (r, k) => r.checks.some((c) => !c.ok && problemOf(c.text).k === k);

/* ---------- отрисовка ---------- */
const section = (title, note = '') => `<div class="section-head"><h2>${title}</h2>${note ? `<span class="muted small">${note}</span>` : ''}</div>`;
const sizeSelect = (n) => `<select class="bs-n" aria-label="Сколько последних видео проверять">${SIZES.map((x) => `<option value="${x}"${x === n ? ' selected' : ''}>${x} видео</option>`).join('')}</select>`;
const lead = 'SEO-оценка всех последних видео канала: что чинить в первую очередь и где больше всего упущенных просмотров.';

export async function render(root, params = {}, isStale = () => false) {
  const s = await getSettings();
  root.innerHTML = '<div class="v-bulkseo"></div>';
  const wrap = root.firstElementChild;
  const id = s.myChannel;
  if (!id) return emptyState(wrap, root, params, isStale);

  const cached = await getData(cacheKey(id), null);
  const ctx = { wrap, id, isStale, n: SIZES.includes(+params.n) ? +params.n : cached?.n || 30, cached };
  if (cached?.results?.length && !params.refresh) return showResults(ctx, cached);
  return startScan(ctx);
}

function emptyState(wrap, root, params, isStale) {
  wrap.innerHTML = `${pageHead('SEO моего канала', lead)}
    <div class="empty bs-empty">
      <div class="bs-empty-ic">${icon('checks', 22)}</div>
      <h2>Укажите свой канал</h2>
      <p>Проверим SEO последних видео: заголовки, описания, теги, таймкоды и субтитры — и покажем, что исправить в первую очередь.</p>
      <form class="bs-pick" id="pick">
        <div class="search">${icon('search', 16)}<input id="ch" aria-label="Ваш канал" placeholder="@handle, ссылка или ID канала" autocomplete="off"></div>
        <button class="btn">Проверить</button>
      </form>
      <div id="pickErr"></div>
      <p class="small">Канал можно сменить в <a href="#/settings">настройках</a>.</p>
    </div>`;
  $('#pick', wrap).addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#ch', wrap).value.trim();
    if (!q) return $('#ch', wrap).focus();
    const btn = $('#pick .btn', wrap);
    btn.disabled = true;
    btn.textContent = 'Ищу канал…';
    try {
      const cid = await resolveChannelId(q);
      await saveSettings({ myChannel: cid });
      if (!isStale()) await render(root, params, isStale);
    } catch (err) {
      $('#pickErr', wrap).innerHTML = errorHtml(err);
      btn.disabled = false;
      btn.textContent = 'Проверить';
    }
  });
}

async function startScan(ctx) {
  const { wrap, id, isStale, n } = ctx;
  let cancel = false;
  wrap.innerHTML = `${pageHead('SEO моего канала', lead)}
    <div class="card bs-progress" aria-busy="true">
      <div class="bs-prog-top"><span class="bs-prog-t" aria-live="polite">Загружаю список видео…</span>
        <button class="btn ghost sm" id="stop">${icon('x', 14)} Отменить</button></div>
      <div class="bar" role="progressbar" aria-label="Прогресс проверки" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="0"><div style="width:0%"></div></div>
      <div class="muted small bs-prog-s">Проверяю последние ${n} видео: описание, теги, таймкоды и субтитры каждого. Обычно это занимает до минуты.</div>
    </div>`;
  const t = $('.bs-prog-t', wrap), bar = $('.bar', wrap);
  $('#stop', wrap).addEventListener('click', (e) => {
    cancel = true;
    e.currentTarget.disabled = true;
    t.textContent = 'Останавливаю…';
  });
  let data;
  try {
    data = await scanChannel(id, n, {
      shouldStop: () => cancel || isStale(),
      onProgress: (done, total, ch) => {
        if (isStale()) return;
        t.innerHTML = total ? `Проверено <b class="mono">${done}</b> из <b class="mono">${total}</b>` : 'На канале нет видео';
        bar.setAttribute('aria-valuemax', total);
        bar.setAttribute('aria-valuenow', done);
        bar.firstElementChild.style.width = (total ? (done / total) * 100 : 100) + '%';
        if (ch?.title) $('.bs-prog-s', wrap).textContent = `${ch.title} · проверяю описание, теги, таймкоды и субтитры каждого видео`;
      },
    });
  } catch (e) {
    console.error(e);
    if (isStale()) return;
    wrap.innerHTML = `${pageHead('SEO моего канала', lead)}${errorHtml(e)}<div class="row bs-retry"><button class="btn" id="retry">${icon('refresh', 15)} Повторить</button><a href="#/settings">Сменить канал</a></div>`;
    $('#retry', wrap).addEventListener('click', () => startScan(ctx));
    return;
  }
  if (isStale()) return;
  if (data.stopped) {
    toast('Проверка остановлена');
    if (ctx.cached?.results?.length) return showResults(ctx, ctx.cached);
    if (!data.results.length) {
      wrap.innerHTML = `${pageHead('SEO моего канала', lead)}<div class="empty bs-empty"><p>Проверка отменена.</p>
        <div class="row bs-center">${sizeSelect(n)}<button class="btn" id="again">${icon('refresh', 15)} Начать заново</button></div></div>`;
      $('#again', wrap).addEventListener('click', () => { ctx.n = +$('.bs-n', wrap).value; startScan(ctx); });
      return;
    }
    return showResults(ctx, data, true);
  }
  if (!data.results.length) {
    wrap.innerHTML = `${pageHead('SEO моего канала', lead)}<div class="empty bs-empty"><p>${data.total ? 'Не удалось получить данные видео — YouTube мог временно ограничить запросы.' : 'На вкладке «Видео» канала нет роликов.'}</p>
      <div class="row bs-center"><button class="btn" id="retry">${icon('refresh', 15)} Повторить</button><a href="#/settings">Сменить канал</a></div></div>`;
    $('#retry', wrap).addEventListener('click', () => startScan(ctx));
    return;
  }
  const { ms, ...save } = data;
  await setData(cacheKey(id), save);
  ctx.cached = save;
  showResults(ctx, save);
}

function showResults(ctx, data, partial = false) {
  const { wrap } = ctx;
  const sum = summarize(data.results);
  const ch = data.channel || {};
  const when = partial ? 'проверка прервана' : `Проверено ${timeAgo(new Date(data.at).toISOString())}`;
  const head = `<span class="bs-ch">${ch.thumb ? `<img src="${esc(ch.thumb)}" alt="">` : ''}<b>${esc(ch.title || 'Мой канал')}</b></span>
    <span class="bs-when">${esc(when)} · <button type="button" class="bs-link" id="upd">Обновить</button></span>`;
  const notes = [
    partial && `Проверка остановлена: оценено ${data.results.length} из ${data.total} видео. Результат не сохранён.`,
    data.failed && `Не удалось проверить ${data.failed} видео — YouTube не отдал их данные.`,
  ].filter(Boolean);
  const maxBand = Math.max(1, ...sum.bands.map((b) => b.n));

  wrap.innerHTML = `${pageHead('SEO моего канала', head, `${sizeSelect(ctx.n)}<button class="btn ghost" id="rescan">${icon('refresh', 15)} Проверить заново</button>`)}
    ${notes.map((x) => `<div class="notice">${icon('alert', 16)}<span>${esc(x)}</span></div>`).join('')}

    <section class="bs-summary" aria-label="Сводка">
      <div class="card bs-avg">
        ${gauge(sum.avgScore, 'Средняя SEO-оценка')}
        <div class="bs-stats">
          ${stat('Видео проверено', `<span>${sum.N}</span>`)}
          ${stat('Без тегов', `<span class="${sum.noTags ? 'bad' : ''}">${sum.noTags}</span>`)}
          ${stat('Без таймкодов', `<span class="${sum.noStamps ? 'bad' : ''}">${sum.noStamps}</span>`)}
        </div>
      </div>
      <div class="card bs-dist">
        <h3>Распределение оценок</h3>
        <ul class="bs-bands">${sum.bands.map((b) => `<li class="${b.c}">
          <span class="bs-band-t mono">${b.t}</span>
          <span class="bs-band-bar" aria-hidden="true"><i style="width:${(b.n / maxBand) * 100}%"></i></span>
          <span class="bs-band-n mono">${b.n}</span></li>`).join('')}</ul>
        <p class="muted small">Число видео в каждом диапазоне оценки.</p>
      </div>
    </section>

    <div class="bs-cols">
      <section>
        ${section('Частые проблемы', 'нажмите, чтобы отфильтровать видео')}
        ${sum.problems.length ? `<ol class="bs-problems">${sum.problems.slice(0, 8).map((p) => `<li><button type="button" class="bs-prob" data-k="${esc(p.k)}" aria-pressed="false">
          <span class="bs-prob-t">${esc(p.short)} <span class="muted">— <b class="mono">${p.fail}</b> из <span class="mono">${p.of}</span></span></span>
          <span class="bs-prob-bar" aria-hidden="true"><i style="width:${(p.fail / p.of) * 100}%"></i></span></button></li>`).join('')}</ol>`
          : '<p class="muted">Все проверки пройдены — отличная работа.</p>'}
      </section>
      <section>
        ${section('Быстрые победы')}
        ${sum.wins.length ? `<ul class="bs-wins">${sum.wins.map((w) => `<li>
          <span class="bs-win-gain mono">+${w.avgGain >= 1 ? Math.round(w.avgGain) : w.avgGain.toFixed(1)}</span>
          <div><b>${esc(w.short)}</b> <span class="muted small">· ${w.fail} видео</span><div class="muted small">${esc(w.easy)}</div></div></li>`).join('')}</ul>
          <p class="muted small">Цифра — прирост средней оценки канала, если исправить во всех видео.</p>`
          : '<p class="muted">Простых правок не осталось — переходите к заголовкам.</p>'}
      </section>
    </div>

    ${section('Видео', 'сначала — где больше всего упущенных просмотров')}
    <div class="bs-filters" role="group" aria-label="Фильтры"></div>
    <div class="table-tools"><span class="table-tools-n" id="cnt"></span></div>
    <div id="tbl"></div>`;

  const filters = { low: false, notags: false, nostamps: false, problem: null };
  const sorted = [...data.results].sort((a, b) => potential(b) - potential(a));
  const counts = {
    low: data.results.filter((r) => r.score < 60).length,
    notags: sum.noTags,
    nostamps: sum.noStamps,
  };
  const visible = () => sorted.filter((r) =>
    (!filters.low || r.score < 60) && (!filters.notags || !r.tags) && (!filters.nostamps || failed(r, 'stamps')) && (!filters.problem || failed(r, filters.problem)));

  const drawFilters = () => {
    const p = filters.problem && sum.problems.find((x) => x.k === filters.problem);
    const chip = (k, t) => `<button type="button" class="chip bs-f" data-f="${k}" aria-pressed="${filters[k]}">${t}<b>${counts[k]}</b></button>`;
    $('.bs-filters', wrap).innerHTML = `${chip('low', 'Оценка ниже 60')}${chip('notags', 'Без тегов')}${chip('nostamps', 'Без таймкодов')}
      ${p ? `<button type="button" class="chip bs-f" data-f="problem" aria-pressed="true">${esc(p.short)}<b>${p.fail}</b>${icon('x', 12)}</button>` : ''}`;
    $$('.bs-f', wrap).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.f;
      if (k === 'problem') filters.problem = null; else filters[k] = !filters[k];
      update();
    }));
    $$('.bs-prob', wrap).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === filters.problem)));
  };
  const update = () => { drawFilters(); drawTable($('#tbl', wrap), visible(), $('#cnt', wrap), sorted.length); };

  $$('.bs-prob', wrap).forEach((b) => b.addEventListener('click', () => {
    filters.problem = filters.problem === b.dataset.k ? null : b.dataset.k;
    update();
    $('.bs-filters', wrap).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  // CSV — только если общий хелпер есть в ui.js
  if (typeof ui.downloadCsv === 'function') {
    const onCsv = () => {
      const rows = visible();
      const name = ui.downloadCsv('tubelens-seo-' + (ch.handle || ch.id || 'channel').replace(/^@/, ''),
        ['Заголовок', 'Ссылка', 'Просмотры', 'SEO-оценка', 'Потенциал', 'Ключевая фраза', 'Тегов', 'Не пройдено', 'Опубликовано'],
        rows.map((r) => [r.title, 'https://www.youtube.com/watch?v=' + r.id, r.views, r.score, potential(r), r.keyword, r.tags,
          r.checks.filter((c) => !c.ok).map((c) => problemOf(c.text).short).join('; '), r.publishedAt ? String(r.publishedAt).slice(0, 10) : '']));
      toast('Сохранено: ' + name);
    };
    const btn = typeof ui.csvButton === 'function' ? ui.csvButton(onCsv) : Object.assign(document.createElement('button'), { className: 'btn ghost sm csv-btn', textContent: 'CSV', onclick: onCsv });
    $('.table-tools', wrap).append(btn);
  }

  const rescan = () => { ctx.n = +$('.bs-n', wrap).value; startScan(ctx); };
  $('#rescan', wrap).addEventListener('click', rescan);
  $('#upd', wrap).addEventListener('click', rescan);
  update();
}

// главные провалы видео — самые «дорогие» проверки
const topFails = (r) => r.checks.filter((c) => !c.ok).sort((a, b) => b.weight - a.weight);

function drawTable(el, rows, cntEl, total) {
  cntEl.textContent = rows.length === total ? `${total} видео` : `${rows.length} из ${total} видео`;
  if (!rows.length) {
    el.innerHTML = '<div class="empty">Под эти фильтры не попало ни одного видео.</div>';
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table class="bs-table"><thead><tr>
      <th>Видео</th><th class="num bs-c-views">Просмотры</th><th class="num">SEO</th><th class="bs-c-fails">Главное исправить</th><th class="num"><span class="sr">Действия</span></th></tr></thead>
    <tbody>${rows.map((r) => {
      const f = topFails(r);
      const cls = scoreClass(r.score);
      return `<tr class="click bs-row" data-id="${esc(r.id)}" tabindex="0" aria-expanded="false" title="Показать чеклист">
        <td><div class="vcell"><img loading="lazy" src="${esc(r.thumb)}" alt=""><div><div class="tt">${esc(r.title)}</div>
          <div class="muted small">${r.publishedAt ? esc(timeAgo(r.publishedAt)) : ''}<span class="bs-mviews"> · ${fmt(r.views)} просм.</span>${r.keyword ? ` · ключ «${esc(r.keyword)}»` : ' · без тегов'}</div></div></div></td>
        <td class="num bs-c-views">${fmt(r.views)}</td>
        <td class="num"><span class="bs-score ${cls}" title="SEO-оценка ${r.score} из 100">${r.score}</span></td>
        <td class="bs-c-fails">${f.length ? `<div class="bs-fails">${f.slice(0, 2).map((c) => `<span>${esc(problemOf(c.text).short)}</span>`).join('')}${f.length > 2 ? `<span class="more mono">+${f.length - 2}</span>` : ''}</div>` : '<span class="good small">Всё в порядке</span>'}</td>
        <td class="num"><button type="button" class="btn sm bs-fix" data-fix="${esc(r.id)}" data-kw="${esc(r.keyword || '')}" title="Анализ видео и AI-оптимизация" aria-label="Исправить: анализ видео и AI-оптимизация">${icon('wand', 14)}<span>Исправить</span></button></td>
      </tr>
      <tr class="bs-detail" hidden><td colspan="5"><div class="bs-detail-in">
        <div class="bs-detail-h"><span class="muted small">Чеклист · ${r.checks.filter((c) => c.ok).length} из ${r.checks.length} пройдено${r.keyword ? ` · ключевая фраза «${esc(r.keyword)}» (первый тег)` : ''}</span>
          <a class="small" href="https://www.youtube.com/watch?v=${esc(r.id)}" target="_blank" rel="noopener">${icon('external', 13)} YouTube</a></div>
        ${checklist(r.checks)}</div></td></tr>`;
    }).join('')}</tbody></table></div>`;

  $$('.bs-fix', el).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    go('video', { id: b.dataset.fix, kw: b.dataset.kw });
  }));
  $$('tr.bs-row', el).forEach((tr) => {
    const toggle = () => {
      const open = tr.getAttribute('aria-expanded') !== 'true';
      tr.setAttribute('aria-expanded', String(open));
      tr.nextElementSibling.hidden = !open;
    };
    tr.addEventListener('click', (e) => { if (!e.target.closest('a,button')) toggle(); });
    tr.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); toggle(); }
    });
  });
}
