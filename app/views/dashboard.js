import { $, esc, fmt, pct, stat, go, icon, timeAgo, withLoading, videoTable, aiOutput, loadingHtml, errorHtml, pageHead } from '../ui.js';
import { getSettings, getRecent } from '../../lib/storage.js';
import { presetById } from '../../lib/presets.js';
import { channelAudit, channelContext } from '../../lib/analysis.js';
import { parseVideoId } from '../../lib/youtube.js';
import { ask } from '../../lib/ai.js';
import { SYSTEM } from '../../lib/prompts.js';

// Что ввёл пользователь: ссылка на видео, канал или поисковый запрос (используется и командной строкой в app.js)
export function routeInput(raw) {
  const v = raw.trim();
  if (!v) return null;
  if (/youtu\.?be/.test(v) && parseVideoId(v) && !/\/(@|channel\/|c\/|user\/)/.test(v)) return ['video', { id: parseVideoId(v) }];
  if (/youtube\.com\/(@|channel\/|c\/|user\/)/.test(v) || /^@[\w.\-À-￿]+$/.test(v) || /^UC[\w-]{22}$/.test(v)) return ['channel', { q: v }];
  return ['keywords', { q: v }];
}

const KIND = { video: ['play', 'Видео'], channel: ['chart', 'Канал'], keyword: ['key', 'Запрос'] };

// Подсказка про командную строку в шапке: клик ставит в неё фокус
const cmdHint = () => `<button type="button" class="dash-cmd" data-cmd>${icon('search', 14)}<span>Ссылка на видео, @канал или запрос — в строке сверху</span><kbd>/</kbd></button>`;

// «Плёнка» последних выпусков: каждое видео — деление, высота — просмотры относительно медианы канала
function reel(videos, median) {
  const list = videos.filter((v) => Number.isFinite(v.views)).slice(0, 30).reverse();
  if (list.length < 3 || !median) return '';
  const CAP = 4; // ×4 к медиане — верх шкалы
  const bars = list.map((v) => {
    const x = v.views / median;
    const h = Math.max(4, Math.min(100, (x / CAP) * 100));
    const cls = x >= 2 ? 'hi' : x >= 1 ? 'ok' : 'lo';
    return `<i class="${cls}" style="height:${h.toFixed(1)}%" title="${esc(v.title)} — ${fmt(v.views)} просм., ×${x.toFixed(1)}"></i>`;
  }).join('');
  const hi = list.filter((v) => v.views / median >= 2).length;
  return `<figure class="dash-reel" aria-label="Просмотры последних ${list.length} видео относительно медианы канала; ${hi} выше ×2">
    <figcaption><span class="eyebrow">Последние ${list.length} выпусков</span><span class="muted small">${hi ? `<span class="mono">${hi}</span> выше ×2` : 'без всплесков'}</span></figcaption>
    <div class="dash-reel-track"><span class="dash-reel-med" style="bottom:${100 / CAP}%"></span>${bars}</div>
    <div class="dash-reel-scale"><span>раньше</span><span class="dash-reel-key"><span><i class="k-med"></i>медиана</span><span><i class="k-hi"></i>×2 и выше</span></span><span>сейчас</span></div></figure>`;
}

export async function render(root) {
  const s = await getSettings();
  const recent = await getRecent();
  const aiReady = !!s.ai.baseUrl && (!!s.ai.apiKey || presetById(s.ai.preset).noKey);

  root.innerHTML = `<div class="v-dashboard">${pageHead('Обзор', s.myChannel ? 'Ваш канал, идеи на сегодня и всё, что вы недавно проверяли.' : 'Стартовая точка: ваш канал и история проверок.')}
    ${s.myChannel && !aiReady ? `<div class="notice">${icon('settings', 16)}<span>Подключите AI в <a href="#/settings">настройках</a>, чтобы получать идеи видео, заголовки и описания.</span></div>` : ''}
    <div id="mine">${s.myChannel ? '' : `
      <section class="dash-empty" aria-labelledby="dashEmptyT">
        <div class="eyebrow">Мой канал</div>
        <h2 id="dashEmptyT">Подключите свой канал</h2>
        <p class="muted">Здесь появятся медиана просмотров, ритм публикаций, аутлаеры и идеи следующих видео — на основе ваших последних 30 выпусков.</p>
        <div class="row"><a class="btn" href="#/settings">${icon('settings', 14)} Указать канал</a>${cmdHint()}</div>
        ${!aiReady ? `<p class="muted small dash-empty-ai">${icon('sparkles', 13)} AI тоже не подключён — его можно настроить там же.</p>` : ''}
      </section>`}</div>
    <div class="section-head"><h2>Недавние проверки</h2>${recent.length ? `<span class="muted small mono">${Math.min(recent.length, 10)} из ${recent.length}</span>` : ''}</div>
    ${recent.length ? `<ul class="recent">${recent.slice(0, 10).map((r, i) => `<li data-i="${i}" tabindex="0">
        ${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : `<span class="kind">${icon(KIND[r.type]?.[0] || 'search', 14)}</span>`}
        <span class="t"><b>${esc(r.title)}</b> <span class="muted small">· ${KIND[r.type]?.[1] || ''}${r.sub ? ' · ' + esc(r.sub) : ''}</span></span>
        <span class="when">${timeAgo(new Date(r.at).toISOString())}</span></li>`).join('')}</ul>`
      : `<div class="empty"><p>Здесь появятся видео, каналы и запросы, которые вы проверяли.</p>${s.myChannel ? cmdHint() : ''}</div>`}</div>`;

  root.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => document.getElementById('cmdInput')?.focus()));
  const open = (r) => go(r.type === 'video' ? 'video' : r.type === 'channel' ? 'channel' : 'keywords', r.type === 'video' ? { id: r.key } : { q: r.key });
  root.querySelectorAll('.recent li').forEach((li) => {
    li.addEventListener('click', () => open(recent[+li.dataset.i]));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(recent[+li.dataset.i]); });
  });

  if (!s.myChannel) return;
  const mine = $('#mine', root);
  const a = await withLoading(mine, 'Загружаю ваш канал…', () => channelAudit(s.myChannel, 30));
  if (!a) return;
  const c = a.channel;
  const share = c.subs ? (a.median / c.subs) * 100 : null;
  mine.innerHTML = `
    <section class="dash-hero" aria-labelledby="dashName">
      <header class="dash-id">
        ${c.thumb ? `<img class="dash-ava" src="${esc(c.thumb)}" alt="">` : `<span class="dash-ava"></span>`}
        <div class="dash-who"><div class="eyebrow">Мой канал</div><h2 id="dashName">${esc(c.title)}</h2>
          <div class="muted small">${esc(c.handle)}${c.videos ? ` · <span class="mono">${fmt(c.videos)}</span> видео` : ''}</div></div>
        <button class="btn ghost sm" id="audit">${icon('chart', 14)} Полный аудит</button>
      </header>
      <div class="dash-body">
        <div class="dash-key">
          <div class="eyebrow">Медиана просмотров</div>
          <div class="hero-num">${fmt(a.median)}</div>
          <div class="muted small">последние ${a.videos.length} видео${share != null ? ` · <span class="mono">${share.toFixed(1)}%</span> от подписчиков` : ''}</div>
        </div>
        ${reel(a.videos, a.median)}
      </div>
      <div class="grid dash-stats">
        ${stat('Подписчики', (c.subsApprox ? '≈' : '') + fmt(c.subs))}${stat('Видео в неделю', a.perWeek.toFixed(1))}
        ${stat('Вовлечённость', pct(a.avgEng))}${stat('Аутлаеры', a.outliers.length, '×2 и выше к медиане')}
      </div>
    </section>
    <div class="section-head"><h2>Идеи на сегодня</h2><button class="btn sm" id="ideas">${icon('bulb', 14)} Предложить идеи</button></div>
    <div id="ideasOut"><p class="muted small dash-idle">AI предложит 5 тем для следующих видео — с опорой на ваши аутлаеры и нишу: заголовок, хук и почему сработает.</p></div>
    <div class="section-head"><h2>Последние видео</h2></div>
    <div id="recentVids"></div>`;
  $('#audit', mine).addEventListener('click', () => go('channel', { q: c.id }));
  videoTable($('#recentVids', mine), a.videos.slice(0, 10), ['video', 'views', 'vph', 'eng', 'out'], undefined, { csvName: 'tubelens-my-videos' });
  $('#ideas', mine).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const out = $('#ideasOut', mine);
    btn.disabled = true;
    out.innerHTML = loadingHtml('AI подбирает идеи…');
    try {
      aiOutput(out, await ask(
        `${channelContext(a)}\n\nПредложи 5 идей для следующих видео этого канала, опираясь на аутлаеры и тренды ниши. ` +
          'Для каждой: заголовок, хук, почему сработает.',
        SYSTEM
      ));
    } catch (err) {
      out.innerHTML = errorHtml(err);
    }
    btn.disabled = false;
  });
}
