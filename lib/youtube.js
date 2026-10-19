// Обёртка над YouTube Data API v3 + бесплатные источники (автоподсказки, страница видео).
// Без ключа API все функции автоматически работают через InnerTube (lib/innertube.js).
import { getSettings, cacheGet, cacheSet, addQuota } from './storage.js';
import * as it from './innertube.js';

const hasKey = async () => !!(await getSettings()).ytApiKey;

const API = 'https://www.googleapis.com/youtube/v3/';

// Стоимость запросов в единицах квоты
const COST = { search: 100, videos: 1, channels: 1, playlistItems: 1, videoCategories: 1, commentThreads: 1 };

export class NoKeyError extends Error {
  constructor() {
    super('NO_KEY: укажите ключ YouTube Data API в настройках');
    this.code = 'NO_KEY';
  }
}

async function api(endpoint, params, ttl = 3600) {
  const { ytApiKey } = await getSettings();
  if (!ytApiKey) throw new NoKeyError();
  const url = new URL(API + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const ck = 'yt:' + endpoint + url.search;
  const cached = await cacheGet(ck);
  if (cached) return cached;
  url.searchParams.set('key', ytApiKey);
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('YouTube API: ' + (json?.error?.message || 'HTTP ' + res.status));
  await addQuota(COST[endpoint] || 1);
  await cacheSet(ck, json, ttl);
  return json;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export function parseISODuration(d) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

const pickThumb = (t = {}, order) => (order.map((k) => t[k]).find(Boolean) || {}).url || '';

export function normalizeVideo(item) {
  const s = item.snippet || {};
  const st = item.statistics || {};
  const cd = item.contentDetails || {};
  return {
    id: typeof item.id === 'string' ? item.id : item.id?.videoId,
    title: s.title || '',
    description: s.description || '',
    tags: s.tags || [],
    channelId: s.channelId,
    channelTitle: s.channelTitle,
    publishedAt: s.publishedAt,
    categoryId: s.categoryId,
    lang: s.defaultAudioLanguage || s.defaultLanguage || '',
    live: s.liveBroadcastContent && s.liveBroadcastContent !== 'none',
    thumb: pickThumb(s.thumbnails, ['medium', 'high', 'default']),
    thumbHi: pickThumb(s.thumbnails, ['maxres', 'standard', 'high', 'medium']),
    duration: parseISODuration(cd.duration),
    definition: cd.definition || '',
    caption: cd.caption === 'true',
    views: +st.viewCount || 0,
    // скрытые лайки / выключенные комментарии — null (неизвестно), а не 0, иначе вовлечённость занижается
    likes: st.likeCount != null ? +st.likeCount : null,
    comments: st.commentCount != null ? +st.commentCount : null,
    hasStats: !!item.statistics,
  };
}

export function normalizeChannel(item) {
  const s = item.snippet || {};
  const st = item.statistics || {};
  return {
    id: item.id,
    title: s.title || '',
    handle: s.customUrl || '',
    description: s.description || '',
    country: s.country || '',
    publishedAt: s.publishedAt,
    thumb: pickThumb(s.thumbnails, ['medium', 'default', 'high']),
    subs: +st.subscriberCount || 0,
    hiddenSubs: !!st.hiddenSubscriberCount,
    views: +st.viewCount || 0,
    videos: +st.videoCount || 0,
    uploadsId: item.contentDetails?.relatedPlaylists?.uploads || 'UU' + String(item.id).slice(2),
    keywords: item.brandingSettings?.channel?.keywords || '',
  };
}

export async function getVideos(ids) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!(await hasKey())) return (await it.enrich(ids.map((id) => ({ id })))).filter((v) => v.title);
  const out = [];
  for (const part of chunk(ids, 50)) {
    const j = await api('videos', { part: 'snippet,statistics,contentDetails', id: part.join(','), maxResults: 50 }, 1800);
    out.push(...(j.items || []).map(normalizeVideo));
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => order.get(a.id) - order.get(b.id));
}

export async function getChannels(ids) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!(await hasKey())) {
    const res = await Promise.all(ids.map((id) => it.channelPage(id).then((r) => r.channel).catch(() => null)));
    return res.filter(Boolean);
  }
  const out = [];
  for (const part of chunk(ids, 50)) {
    const j = await api('channels', { part: 'snippet,statistics,contentDetails,brandingSettings', id: part.join(','), maxResults: 50 }, 6 * 3600);
    out.push(...(j.items || []).map(normalizeChannel));
  }
  return out;
}

export async function getChannel(id) {
  const [c] = await getChannels([id]);
  if (!c) throw new Error('Канал не найден');
  return c;
}

export function parseVideoId(input) {
  input = String(input || '').trim();
  const m =
    /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/.exec(input) || /^([\w-]{11})$/.exec(input);
  return m ? m[1] : null;
}

// Принимает: UC..., @handle, ссылку на канал / видео, или название
export async function resolveChannelId(input) {
  input = String(input || '').trim();
  if (!input) throw new Error('Пустой ввод');
  let m = /(UC[\w-]{22})/.exec(input);
  if (m) return m[1];
  if (!(await hasKey())) {
    if (/youtu/.test(input) && parseVideoId(input)) return (await it.videoDetails(parseVideoId(input))).channelId;
    return it.resolveChannel(input.replace(/\/(videos|shorts|streams|featured|about|playlists).*$/, ''));
  }
  const vid = /youtu/.test(input) ? parseVideoId(input) : null;
  if (vid) {
    const [v] = await getVideos([vid]);
    if (v) return v.channelId;
  }
  m = /@([\w.\-À-￿]+)/.exec(decodeURIComponent(input));
  if (m) {
    const j = await api('channels', { part: 'id', forHandle: '@' + m[1] }, 86400);
    if (j.items?.[0]) return j.items[0].id;
  }
  m = /youtube\.com\/user\/([\w.-]+)/.exec(input);
  if (m) {
    const j = await api('channels', { part: 'id', forUsername: m[1] }, 86400);
    if (j.items?.[0]) return j.items[0].id;
  }
  const name = input.replace(/^https?:\/\/(www\.)?youtube\.com\/(c\/)?/, '');
  const j = await api('search', { part: 'snippet', type: 'channel', q: name, maxResults: 1 }, 86400);
  const id = j.items?.[0]?.id?.channelId;
  if (!id) throw new Error('Канал не найден: ' + input);
  return id;
}

// full = false — без ключа не уточнять каждое видео через player (достаточно для медианы просмотров)
export async function getUploads(channel, max = 50, full = true) {
  if (!(await hasKey())) {
    const { videos } = await it.channelPage(channel.id, max);
    return full ? it.enrich(videos) : videos;
  }
  const ids = [];
  let pageToken;
  while (ids.length < max) {
    const j = await api('playlistItems', {
      part: 'contentDetails',
      playlistId: channel.uploadsId,
      maxResults: Math.min(50, max - ids.length),
      pageToken,
    }, 1800);
    ids.push(...(j.items || []).map((i) => i.contentDetails.videoId));
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return getVideos(ids);
}

// Поиск с полными данными видео (без ключа — InnerTube + уточнение через player)
export async function searchVideos(q, opts = {}) {
  if (await hasKey()) return getVideos(await searchVideoIds(q, opts));
  const days = opts.publishedAfter ? (Date.now() - new Date(opts.publishedAfter)) / 864e5 : 0;
  const date = !days ? 0 : days <= 1 ? 2 : days <= 7 ? 3 : days <= 31 ? 4 : 5;
  const sort = { viewCount: 3, date: 2 }[opts.order] || 0;
  const found = await it.search(q, { max: opts.max || 25, sort, date });
  return it.enrich(found);
}

// Видео с лайками и комментариями (для подробного анализа)
export async function getVideoFull(id) {
  if (await hasKey()) return (await getVideos([id]))[0];
  return it.videoDetails(id, true);
}

// Поиск видео: возвращает массив ID (с ключом — 100 ед. квоты за запрос)
export async function searchVideoIds(q, opts = {}) {
  if (!(await hasKey())) return (await it.search(q, { max: opts.max || 25 })).map((v) => v.id);
  const s = await getSettings();
  const j = await api('search', {
    part: 'id',
    type: 'video',
    q,
    maxResults: opts.max || 25,
    order: opts.order || 'relevance',
    regionCode: opts.region ?? s.region,
    relevanceLanguage: opts.lang ?? s.hl,
    publishedAfter: opts.publishedAfter,
    videoDuration: opts.duration,
  }, 3 * 3600);
  return (j.items || []).map((i) => i.id.videoId).filter(Boolean);
}

export async function mostPopular(region, categoryId, max = 50) {
  if (!(await hasKey())) {
    throw new Error('NO_KEY: раздел «В тренде» работает только с ключом YouTube API (публичную страницу трендов YouTube убрал). Без ключа используйте «Аутлаеры в нише».');
  }
  const j = await api('videos', {
    part: 'snippet,statistics,contentDetails',
    chart: 'mostPopular',
    regionCode: region,
    videoCategoryId: categoryId || undefined,
    maxResults: max,
  }, 1800);
  return (j.items || []).map(normalizeVideo);
}

export async function topComments(videoId, max = 50) {
  const j = await api('commentThreads', { part: 'snippet', videoId, maxResults: max, order: 'relevance', textFormat: 'plainText' }, 3600);
  return (j.items || []).map((i) => {
    const c = i.snippet.topLevelComment.snippet;
    return { author: c.authorDisplayName, text: c.textDisplay, likes: c.likeCount, publishedAt: c.publishedAt };
  });
}

// ---- бесплатные источники (без ключа) ----

// Автоподсказки YouTube — прокси для популярности поисковых запросов
export async function suggest(q, { hl, gl } = {}) {
  const s = await getSettings();
  hl = hl || s.hl;
  gl = gl || s.region;
  const ck = `sg:${hl}:${gl}:${q}`;
  const cached = await cacheGet(ck);
  if (cached) return cached;
  const url = `https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&oe=utf-8&ie=utf-8&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}&q=${encodeURIComponent(q)}`;
  let list = [];
  try {
    const text = await (await fetch(url)).text();
    const start = text.indexOf('(');
    const data = JSON.parse(text.slice(start + 1, text.lastIndexOf(')')));
    list = (data[1] || []).map((x) => (Array.isArray(x) ? x[0] : x));
  } catch {
    const url2 = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&oe=utf-8&ie=utf-8&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`;
    const data = await (await fetch(url2)).json();
    list = data[1] || [];
  }
  await cacheSet(ck, list, 6 * 3600);
  return list;
}

// Расширенный поиск подсказок: запрос + буквы/модификаторы
export async function suggestDeep(q, extra = 'abcdefghijklmnopqrstuvwxyzабвгдежзиклмнопрстуфхцчшэюя') {
  const seeds = [q, ...[...extra].map((ch) => q + ' ' + ch)];
  const all = new Map();
  const queue = [...seeds];
  const worker = async () => {
    while (queue.length) {
      const seed = queue.shift();
      try {
        (await suggest(seed)).forEach((s, i) => {
          const prev = all.get(s);
          all.set(s, Math.max(prev || 0, 10 - i));
        });
      } catch { /* пропускаем */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  all.delete(q);
  return [...all.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

function extractJson(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const ch = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(html.slice(start, j + 1));
  }
  return null;
}

// Данные видео без API-ключа: парсинг страницы просмотра
export async function scrapeVideo(id) {
  const ck = 'scrape:' + id;
  const cached = await cacheGet(ck);
  if (cached) return cached;
  const html = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`)).text();
  const pr = extractJson(html, 'ytInitialPlayerResponse');
  if (!pr?.videoDetails) throw new Error('Не удалось прочитать страницу видео');
  const d = pr.videoDetails;
  const mf = pr.microformat?.playerMicroformatRenderer || {};
  const likeMatch = /"likeCount":"?(\d+)/.exec(html);
  const v = {
    id,
    title: d.title,
    description: d.shortDescription || '',
    tags: d.keywords || [],
    channelId: d.channelId,
    channelTitle: d.author,
    publishedAt: mf.publishDate || mf.uploadDate,
    categoryId: '',
    category: mf.category,
    thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    thumbHi: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    duration: +d.lengthSeconds || 0,
    views: +d.viewCount || 0,
    likes: likeMatch ? +likeMatch[1] : 0,
    comments: 0,
    caption: !!pr.captions,
    definition: '',
    hasStats: true,
    scraped: true,
  };
  await cacheSet(ck, v, 1800);
  return v;
}

export const CATEGORIES = {
  '': 'Все категории', 1: 'Фильмы и анимация', 2: 'Авто', 10: 'Музыка', 15: 'Животные', 17: 'Спорт',
  19: 'Путешествия', 20: 'Игры', 22: 'Люди и блоги', 23: 'Юмор', 24: 'Развлечения', 25: 'Новости и политика',
  26: 'Хобби и стиль', 27: 'Образование', 28: 'Наука и техника',
};

export const REGIONS = ['US', 'GB', 'DE', 'FR', 'ES', 'IT', 'PL', 'UA', 'RU', 'KZ', 'BY', 'TR', 'BR', 'MX', 'IN', 'ID', 'JP', 'KR', 'CA', 'AU'];
