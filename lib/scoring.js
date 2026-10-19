// Метрики и эвристические оценки. Все формулы открыты — меняйте под себя.

export const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

export function median(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);

export const hoursSince = (iso) => Math.max(1, (Date.now() - new Date(iso).getTime()) / 36e5);

// Просмотры в час (VPH) за всё время жизни видео
export const vph = (v) => v.views / hoursSince(v.publishedAt);

// Вовлечённость: (лайки + комментарии) / просмотры, %. null — лайки неизвестны (режим без ключа)
export const engagement = (v) => (v.likes == null || !v.views ? null : ((v.likes + (v.comments || 0)) / v.views) * 100);

// Аутлаер-множитель: во сколько раз видео лучше медианы канала
export const outlier = (v, channelMedian) => (channelMedian ? v.views / channelMedian : 0);

// Логарифмическая шкала: 10^lo -> 0, 10^hi -> 100
const logScore = (x, lo, hi) => clamp(((Math.log10(Math.max(1, x)) - lo) / (hi - lo)) * 100);

export function label(score, inverse = false) {
  const s = inverse ? 100 - score : score;
  if (s >= 80) return 'Очень высокий';
  if (s >= 60) return 'Высокий';
  if (s >= 40) return 'Средний';
  if (s >= 20) return 'Низкий';
  return 'Очень низкий';
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKC');

/**
 * Оценка ключевого слова.
 *  volume      — индекс спроса (медиана просмотров топа + полнота автоподсказок)
 *  competition — сила конкурентов (подписчики, точное вхождение в заголовки, свежесть)
 *  overall     — баланс: высокий спрос + низкая конкуренция = высокая оценка
 */
export function keywordScore(q, { videos, channels, suggestions }) {
  const top = videos.slice(0, 10);
  const chMap = new Map(channels.map((c) => [c.id, c]));
  const views = top.map((v) => v.views);
  const subs = top.map((v) => chMap.get(v.channelId)?.subs || 0);
  const nq = norm(q);
  const titleMatch = top.length ? top.filter((v) => norm(v.title).includes(nq)).length / top.length : 0;
  const fresh = top.length ? top.filter((v) => hoursSince(v.publishedAt) < 24 * 90).length / top.length : 0;
  const smallChannels = top.filter((v) => (chMap.get(v.channelId)?.subs || 0) < 10000 && v.views > 10000).length;

  const medViews = median(views);
  const medSubs = median(subs);
  const volume = Math.round(clamp(logScore(medViews, 2, 7) * 0.85 + Math.min(10, suggestions.length) * 1.5));
  const competition = Math.round(clamp(logScore(medSubs, 2, 7) * 0.5 + titleMatch * 100 * 0.3 + fresh * 100 * 0.2));
  const overall = Math.round(clamp(volume * 0.55 + (100 - competition) * 0.45));

  const insights = [];
  if (smallChannels >= 2) insights.push(`В топ-10 есть ${smallChannels} небольших канала(ов) (<10K подписчиков) с хорошими просмотрами — шанс пробиться реален.`);
  if (titleMatch < 0.3) insights.push('Мало видео с точной фразой в заголовке — используйте её дословно, это преимущество.');
  if (fresh > 0.6) insights.push('Выдача очень свежая — тема горячая, но конкуренты активно публикуют.');
  if (fresh < 0.2) insights.push('Выдача старая — можно занять место новым, более качественным видео.');
  if (volume < 25) insights.push('Низкий спрос — попробуйте более широкую формулировку.');
  if (competition > 70) insights.push('Сильные каналы в топе — ищите длинный хвост (более узкие запросы).');

  return {
    overall, volume, competition, medViews, medSubs,
    titleMatch: Math.round(titleMatch * 100),
    fresh: Math.round(fresh * 100),
    avgVph: Math.round(avg(top.map(vph))),
    insights,
  };
}

/** SEO-чеклист видео. keyword — целевая фраза (если не задана — первый тег). */
export function videoSeo(v, keyword) {
  const kw = norm(keyword || v.tags?.[0] || '');
  const title = v.title || '';
  const desc = v.description || '';
  const tags = v.tags || [];
  const tagsLen = tags.join(',').length;
  const hashtags = (desc.match(/#[\p{L}\p{N}_]+/gu) || []).length + (title.match(/#[\p{L}\p{N}_]+/gu) || []).length;
  const stamps = (desc.match(/(^|\s)\d{1,2}:\d{2}(:\d{2})?/gm) || []).length;
  const letters = title.replace(/[^\p{L}]/gu, '');
  const capsRatio = letters ? letters.replace(/[^\p{Lu}]/gu, '').length / letters.length : 0;

  const checks = [
    { w: 10, ok: title.length >= 20 && title.length <= 70, t: `Длина заголовка 20–70 символов (сейчас ${title.length})` },
    { w: 15, ok: kw && norm(title).includes(kw), t: 'Ключевая фраза в заголовке', skip: !kw },
    { w: 5, ok: kw && norm(title).indexOf(kw) > -1 && norm(title).indexOf(kw) < title.length / 2, t: 'Ключевая фраза в начале заголовка', skip: !kw },
    { w: 10, ok: desc.length >= 250, t: `Описание от 250 символов (сейчас ${desc.length})` },
    { w: 10, ok: kw && norm(desc.slice(0, 200)).includes(kw), t: 'Ключевая фраза в первых 200 символах описания', skip: !kw },
    { w: 10, ok: tags.length >= 5 && tags.length <= 30, t: `5–30 тегов (сейчас ${tags.length})` },
    { w: 5, ok: tagsLen >= 150 && tagsLen <= 500, t: `Теги занимают 150–500 символов (сейчас ${tagsLen})` },
    { w: 10, ok: kw && tags.some((t) => norm(t).includes(kw)), t: 'Ключевая фраза в тегах', skip: !kw },
    { w: 5, ok: stamps >= 3, t: 'Таймкоды / главы в описании' },
    { w: 5, ok: hashtags >= 1 && hashtags <= 15, t: `Хэштеги 1–15 (сейчас ${hashtags})` },
    { w: 3, ok: /https?:\/\//.test(desc), t: 'Ссылки / призыв к действию в описании' },
    { w: 5, ok: v.caption, t: 'Субтитры', skip: v.caption == null },
    { w: 2, ok: v.definition === 'hd', t: 'HD-качество', skip: !v.definition },
    { w: 5, ok: capsRatio < 0.6, t: 'Заголовок не написан КАПСОМ целиком' },
  ].filter((c) => !c.skip);

  const total = checks.reduce((s, c) => s + c.w, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.w : 0), 0);
  return { score: Math.round((got / total) * 100), checks: checks.map((c) => ({ ok: !!c.ok, text: c.t, weight: c.w })), keyword: kw };
}

/** Аудит набора видео канала */
export function channelStats(channel, videos) {
  const vids = videos.filter((v) => !v.live);
  const med = median(vids.map((v) => v.views));
  const dates = vids.map((v) => new Date(v.publishedAt).getTime()).sort((a, b) => a - b);
  const spanWeeks = dates.length > 1 ? (dates[dates.length - 1] - dates[0]) / (7 * 864e5) : 0;
  const perWeek = spanWeeks > 0 ? (dates.length - 1) / spanWeeks : 0;
  const shorts = vids.filter((v) => v.duration > 0 && v.duration <= 60).length;

  // тепловая карта: день недели x блок 3 часа, значение — средняя относительная эффективность
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 8 }, () => ({ sum: 0, n: 0 })));
  for (const v of vids) {
    const d = new Date(v.publishedAt);
    const cell = heat[(d.getDay() + 6) % 7][Math.floor(d.getHours() / 3)];
    cell.sum += med ? v.views / med : 0;
    cell.n++;
  }
  const heatMap = heat.map((row) => row.map((c) => (c.n ? { v: c.sum / c.n, n: c.n } : null)));

  const enriched = vids.map((v) => ({ ...v, vph: vph(v), eng: engagement(v), out: outlier(v, med) }));
  const recent10 = enriched.slice(0, 10);

  const tips = [];
  if (perWeek < 1) tips.push('Меньше одного видео в неделю — регулярность заметно влияет на рост.');
  const engs = enriched.map((v) => v.eng).filter(Number.isFinite);
  if (engs.length && avg(engs) < 2) tips.push('Вовлечённость ниже 2% — добавьте вопросы и призывы к комментариям.');
  const noTags = enriched.filter((v) => !v.tags.length).length;
  if (noTags > enriched.length * 0.3) tips.push(`${noTags} видео без тегов — добавьте 10–20 релевантных тегов.`);
  const shortDesc = enriched.filter((v) => v.description.length < 200).length;
  if (shortDesc > enriched.length * 0.3) tips.push(`${shortDesc} видео с коротким описанием (<200 символов).`);
  const noCaps = enriched.filter((v) => v.caption === false).length;
  if (noCaps > enriched.length * 0.5) tips.push('Большинство видео без загруженных субтитров — это доп. индексация и доступность.');
  const outs = enriched.filter((v) => v.out >= 2);
  if (outs.length) tips.push(`${outs.length} видео-аутлаеров (×2 и выше от медианы) — делайте больше похожих тем.`);
  if (channel.subs && med / channel.subs < 0.05) tips.push('Медианные просмотры < 5% от подписчиков — аудитория «остыла», тестируйте новые темы/обложки.');

  return {
    median: med,
    avgViews: Math.round(avg(vids.map((v) => v.views))),
    recentAvg: Math.round(avg(recent10.map((v) => v.views))),
    avgEng: engs.length ? avg(engs) : null,
    perWeek,
    avgDuration: avg(vids.map((v) => v.duration)),
    shortsShare: vids.length ? shorts / vids.length : 0,
    viewsPerSub: channel.subs ? med / channel.subs : 0,
    heatMap,
    videos: enriched,
    top: [...enriched].sort((a, b) => b.views - a.views).slice(0, 10),
    outliers: [...enriched].filter((v) => v.out >= 2).sort((a, b) => b.out - a.out),
    tips,
  };
}

/** Частота тегов в наборе видео */
export function tagFrequency(videos, limit = 40) {
  const m = new Map();
  for (const v of videos) for (const t of new Set((v.tags || []).map(norm))) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag, count]) => ({ tag, count }));
}
