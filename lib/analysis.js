// Высокоуровневые отчёты: собирают данные из API и считают метрики.
import * as yt from './youtube.js';
import { getSettings } from './storage.js';
import { keywordScore, videoSeo, channelStats, tagFrequency, vph, engagement, outlier, median } from './scoring.js';

export async function keywordReport(q) {
  const [suggestions, videos] = await Promise.all([yt.suggest(q).catch(() => []), yt.searchVideos(q, { max: 25 })]);
  const channels = await yt.getChannels(videos.map((v) => v.channelId));
  const chMap = new Map(channels.map((c) => [c.id, c]));
  const score = keywordScore(q, { videos, channels, suggestions });
  return {
    q,
    score,
    suggestions,
    tags: tagFrequency(videos),
    videos: videos.map((v) => ({ ...v, vph: vph(v), eng: engagement(v), subs: chMap.get(v.channelId)?.subs || 0 })),
  };
}

// Отчёт по видео (с ключом — YouTube API, без ключа — InnerTube)
export async function videoReport(id, keyword) {
  const v = await yt.getVideoFull(id);
  const { ytApiKey } = await getSettings();
  if (!v) throw new Error('Видео не найдено');
  const channel = await yt.getChannel(v.channelId);
  // для медианы хватает приблизительных просмотров со страницы канала (без 30 запросов player)
  const uploads = await yt.getUploads(channel, 30, false).catch(() => []);
  const channelMedian = median(uploads.filter((u) => u.id !== v.id && !u.live).map((u) => u.views));
  return {
    video: { ...v, vph: vph(v), eng: engagement(v), out: outlier(v, channelMedian) },
    channel,
    channelMedian,
    seo: videoSeo(v, keyword),
    hasKey: !!ytApiKey,
  };
}

export async function channelAudit(input, max = 50) {
  const id = await yt.resolveChannelId(input);
  const channel = await yt.getChannel(id);
  const videos = await yt.getUploads(channel, max);
  return { channel, ...channelStats(channel, videos) };
}

// Поиск аутлаеров в нише: видео, которые набрали намного больше подписчиков канала
export async function outlierSearch(q, days = 30, minViews = 1000) {
  const publishedAfter = new Date(Date.now() - days * 864e5).toISOString();
  const videos = await yt.searchVideos(q, { max: 50, order: 'viewCount', publishedAfter });
  const channels = await yt.getChannels(videos.map((v) => v.channelId));
  const chMap = new Map(channels.map((c) => [c.id, c]));
  return videos
    .filter((v) => v.views >= minViews && new Date(v.publishedAt) >= new Date(publishedAfter))
    .map((v) => {
      const subs = chMap.get(v.channelId)?.subs || 0;
      return { ...v, subs, ratio: subs ? v.views / subs : v.views, vph: vph(v), eng: engagement(v) };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

export async function competitorsOverview(ids, perChannel = 15) {
  const channels = await yt.getChannels(ids);
  const rows = await Promise.all(
    channels.map(async (c) => {
      const vids = await yt.getUploads(c, perChannel).catch(() => []);
      const st = channelStats(c, vids);
      return { channel: c, stats: st };
    })
  );
  const feed = rows
    .flatMap((r) => r.stats.videos.map((v) => ({ ...v, channelThumb: r.channel.thumb })))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return { rows, feed };
}

// Позиция видео в поиске по запросу (топ-50)
export async function rankCheck(videoId, q) {
  const ids = await yt.searchVideoIds(q, { max: 50 });
  const pos = ids.indexOf(videoId);
  return pos >= 0 ? pos + 1 : null;
}

// Краткий текстовый контекст канала для AI
export function channelContext(audit) {
  const c = audit.channel;
  const lines = [
    `Канал: ${c.title} (${c.handle}), подписчиков: ${c.subs}, видео: ${c.videos}`,
    `Медиана просмотров: ${Math.round(audit.median)}, публикаций в неделю: ${audit.perWeek.toFixed(1)}, вовлечённость: ${audit.avgEng == null ? 'н/д' : audit.avgEng.toFixed(2) + '%'}`,
    'Последние видео (название — просмотры — множитель к медиане):',
    ...audit.videos.slice(0, 15).map((v) => `- ${v.title} — ${v.views} — x${v.out.toFixed(1)}`),
  ];
  if (audit.outliers.length) lines.push('Лучшие аутлаеры:', ...audit.outliers.slice(0, 5).map((v) => `- ${v.title} (x${v.out.toFixed(1)})`));
  return lines.join('\n');
}
