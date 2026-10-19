// Service worker: открывает боковую панель, обслуживает запросы контент-скрипта.
import { getSettings, saveSettings, pruneCache, getData, setData, cacheGet, cacheSet } from './lib/storage.js';
import * as yt from './lib/youtube.js';
import { videoReport, keywordReport, channelAudit } from './lib/analysis.js';
import { vph, engagement, median } from './lib/scoring.js';
import * as it from './lib/innertube.js';
import { ask } from './lib/ai.js';
import { SYSTEM } from './lib/prompts.js';
import { THEMES } from './app/themes.js';
import * as dl from './lib/downloader.js';

chrome.runtime.onInstalled.addListener((info) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // при обновлении расширения пункт уже существует — пересоздаём, чтобы не было ошибки duplicate id
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: 'tl-open-tab', title: 'Открыть TubeLens во вкладке', contexts: ['action'] }));
  if (info.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html?tab=1#/settings') });
});

chrome.runtime.onStartup.addListener(() => pruneCache().catch(() => {}));
dl.resume().catch(() => {});

// Браузер может не перезапускаться неделями, а сырые ответы YouTube в кэше весят сотни КБ —
// чистим просроченное и при пробуждении service worker, но не чаще раза в 6 часов
(async () => {
  if (Date.now() - (await getData('pruneAt', 0)) < 6 * 3600e3) return;
  await setData('pruneAt', Date.now());
  await pruneCache();
})().catch(() => {});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'tl-open-tab') chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html?tab=1') });
});

// ---- данные для панели канала и множителей на карточках ----
const inflight = new Map();
const once = (key, fn) => {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
};

async function channelIdFromHref(href) {
  if (!href) throw new Error('Не удалось определить канал');
  const m = /(UC[\w-]{22})/.exec(href);
  if (m) return m[1];
  const ck = 'cid:' + href;
  const cached = await cacheGet(ck);
  if (cached) return cached;
  // карточек одного канала на странице много — резолвим @handle один раз
  return once(ck, async () => {
    const id = await yt.resolveChannelId('https://www.youtube.com' + href.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/(videos|shorts|streams|featured|about|playlists).*$/, ''));
    await cacheSet(ck, id, 7 * 86400);
    return id;
  });
}

// Медиана просмотров последних 30 видео канала (для множителя ×N на карточках)
async function channelMedian(href) {
  const id = await channelIdFromHref(href);
  const ck = 'med:' + id;
  const cached = await cacheGet(ck);
  if (cached) return cached;
  return once(ck, async () => {
    const { videos } = await it.channelPage(id, 30);
    const r = { id, median: median(videos.filter((v) => !v.live).map((v) => v.views)) };
    await cacheSet(ck, r, 3 * 3600);
    return r;
  });
}

// История снимков канала: копится при каждом заходе (не чаще раза в 6 часов)
async function snapshot(id, subs, views) {
  const key = 'hist:' + id;
  const list = await getData(key, []);
  const last = list[list.length - 1];
  if (!last || Date.now() - last.t > 6 * 3600e3) {
    list.push({ t: Date.now(), subs, views });
    await setData(key, list.slice(-500));
  }
  return list;
}

async function channelPanel(href) {
  const id = await channelIdFromHref(href);
  return once('panel:' + id, async () => {
    const [{ channel, videos }, about] = await Promise.all([it.channelPage(id, 500), it.channelAbout(id).catch(() => ({}))]);
    const vids = videos.filter((v) => !v.live);
    const recent = vids.slice(0, 30);
    const med = median(recent.map((v) => v.views));
    // накопленные просмотры по дате публикации (от старых к новым)
    let acc = 0;
    const series = vids.filter((v) => Number.isFinite(new Date(v.publishedAt).getTime()))
      .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))
      .map((v) => ({ t: new Date(v.publishedAt).getTime(), v: (acc += v.views), title: v.title }));
    const dates = recent.map((v) => new Date(v.publishedAt).getTime()).sort((a, b) => a - b);
    const weeks = dates.length > 1 ? (dates[dates.length - 1] - dates[0]) / (7 * 864e5) : 0;
    const enriched = vids.map((v) => ({ id: v.id, title: v.title, views: v.views, publishedAt: v.publishedAt, vph: vph(v), out: med ? v.views / med : 0 }));
    const views = about.views ?? acc;
    const history = await snapshot(id, channel.subs, views);
    return {
      channel: { ...channel, views, joined: about.joined, country: about.country },
      tags: it.parseKeywords(channel.keywords),
      median: med,
      perWeek: weeks > 0 ? (dates.length - 1) / weeks : 0,
      series,
      covered: vids.length,
      history,
      top: [...enriched].sort((a, b) => b.views - a.views).slice(0, 8),
      outliers: enriched.slice(0, 60).filter((v) => v.out >= 2).sort((a, b) => b.out - a.out).slice(0, 8),
      recent: enriched.slice(0, 8),
    };
  });
}

// ---- фильтры видео поверх YouTube ----
// Данные канала для карточки: подписчики и медиана последних 30 видео (один запрос на канал, кэш 3 ч)
async function channelBrief(id) {
  const ck = 'brief:' + id;
  const cached = await cacheGet(ck);
  if (cached) return cached;
  return once(ck, async () => {
    const { channel, videos } = await it.channelPage(id, 30);
    const r = { id, subs: channel.subs, title: channel.title, thumb: channel.thumb, median: median(videos.filter((v) => !v.live).map((v) => v.views)) };
    await cacheSet(ck, r, 3 * 3600);
    return r;
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); }
  }));
  return out;
}

const decorate = (v, ch) => {
  const hours = Math.max(1, (Date.now() - new Date(v.publishedAt).getTime()) / 36e5);
  return {
    id: v.id, title: v.title, channelId: v.channelId, channelTitle: v.channelTitle || ch?.title || '', channelThumb: ch?.thumb || '',
    thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, views: v.views, publishedAt: v.publishedAt, publishedText: v.publishedText || '',
    duration: v.duration, ageHours: hours, vph: v.views / hours,
    subs: ch?.subs ?? null, median: ch?.median ?? null,
    out: ch?.median ? v.views / ch.median : null, ratio: ch?.subs ? v.views / ch.subs : null,
  };
};

/**
 * Видео для панели фильтров.
 *  source 'search': q, sort (0 релевантность | 2 дата | 3 просмотры), date (0 | 2 сегодня | 3 неделя | 4 месяц | 5 год)
 *  source 'channel': href канала — все видео канала (до max)
 */
async function filterVideos({ source, q, href, max = 60, sort = 0, date = 0 }) {
  if (source === 'channel') {
    const id = await channelIdFromHref(href);
    const { channel, videos } = await it.channelPage(id, Math.min(max, 500));
    const med = median(videos.slice(0, 30).filter((v) => !v.live).map((v) => v.views));
    const ch = { subs: channel.subs, median: med, title: channel.title, thumb: channel.thumb };
    return { source, title: channel.title, videos: videos.filter((v) => !v.live).map((v) => decorate(v, ch)) };
  }
  if (!q) throw new Error('Введите запрос');
  const found = await it.search(q, { max: Math.min(max, 200), sort, date });
  const ids = [...new Set(found.map((v) => v.channelId).filter(Boolean))];
  const briefs = await mapLimit(ids, 4, channelBrief);
  const map = new Map(briefs.filter(Boolean).map((b) => [b.id, b]));
  return { source, title: q, videos: found.map((v) => decorate(v, map.get(v.channelId))) };
}

// ---- мини-статистика своего канала в шапке YouTube ----
async function myStats({ id }) {
  const settings = await getSettings();
  id = id || settings.myChannel;
  if (!id) return null;
  const [{ channel, videos }, about] = await Promise.all([it.channelPage(id, 5), it.channelAbout(id).catch(() => ({}))]);
  const views = about.views ?? null;
  const history = await snapshot(id, channel.subs, views);
  // прирост к замеру примерно суточной давности (если он есть)
  const dayAgo = [...history].reverse().find((h) => Date.now() - h.t >= 20 * 3600e3);
  const last = videos.find((v) => !v.live);
  return {
    id, title: channel.title, handle: channel.handle, thumb: channel.thumb, subs: channel.subs, subsApprox: true, views, videos: channel.videos,
    last: last ? { id: last.id, title: last.title, views: last.views, vph: vph(last), publishedText: last.publishedText } : null,
    delta: dayAgo ? { hours: Math.round((Date.now() - dayAgo.t) / 36e5), views: views != null && dayAgo.views != null ? views - dayAgo.views : null, subs: channel.subs - dayAgo.subs } : null,
  };
}

// YouTube отклоняет запросы к youtubei/v1 с Origin chrome-extension:// (HTTP 403).
// Для запросов самого TubeLens подставляем Origin/Referer сайта — так же, как их шлёт youtube.com.
const YT_HEADERS_RULE = 1;
chrome.declarativeNetRequest?.updateSessionRules({
  removeRuleIds: [YT_HEADERS_RULE],
  addRules: [{
    id: YT_HEADERS_RULE,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'origin', operation: 'set', value: 'https://www.youtube.com' },
        { header: 'referer', operation: 'set', value: 'https://www.youtube.com/' },
      ],
    },
    condition: { urlFilter: '||www.youtube.com/youtubei/', initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest', 'other'] },
  }],
}).catch((e) => console.warn('[TubeLens] правило заголовков YouTube:', e));

const handlers = {
  settings: () => getSettings(),

  videoReport: ({ id, keyword }) => videoReport(id, keyword),

  keyword: ({ q }) => keywordReport(q),

  suggest: ({ q }) => yt.suggest(q),

  // Компактная статистика для бейджей в выдаче
  videos: async ({ ids }) => {
    const { ytApiKey } = await getSettings();
    if (!ytApiKey) return [];
    const vids = await yt.getVideos(ids);
    return vids.map((v) => ({ id: v.id, views: v.views, vph: vph(v), eng: engagement(v), publishedAt: v.publishedAt }));
  },

  channelSummary: async ({ input }) => {
    const a = await channelAudit(input, 30);
    return {
      channel: a.channel,
      median: a.median,
      recentAvg: a.recentAvg,
      avgEng: a.avgEng,
      perWeek: a.perWeek,
      outliers: a.outliers.slice(0, 3).map((v) => ({ id: v.id, title: v.title, out: v.out })),
    };
  },

  // Цвета темы для панелей на youtube.com (content/theme.js). «auto» — пара тёмная/светлая под режим YouTube
  theme: async () => {
    const { theme } = await getSettings();
    const pick = (id) => THEMES.find((t) => t.id === id);
    if (!theme || theme === 'auto') return { auto: true, dark: pick('graphite'), light: pick('paper') };
    return { theme: pick(theme) || THEMES[0] };
  },

  // Очистка кэша из настроек: чистим и storage, и память этого service worker
  clearCache: () => pruneCache(true),

  channelPanel: ({ href }) => channelPanel(href),

  filterVideos: (msg) => filterVideos(msg),

  myStats: (msg) => myStats(msg),

  // Канал, найденный на странице YouTube (вы вошли в аккаунт) — запоминаем, если свой ещё не указан
  detectedChannel: async ({ href }) => {
    const s = await getSettings();
    if (s.myChannel) return { id: s.myChannel, saved: false };
    const id = await channelIdFromHref(href);
    await saveSettings({ myChannel: id });
    return { id, saved: true };
  },

  channelMedian: ({ href }) => channelMedian(href),

  aiAsk: ({ prompt }) => ask(prompt, SYSTEM),

  // ---- загрузки (yt-dlp через native messaging) ----
  dlStatus: () => dl.status(),
  dlStart: ({ url, preset, title }) => dl.start({ url, preset, title }),
  dlCancel: ({ job }) => dl.cancel(job),
  dlOpen: ({ path }) => dl.openFolder(path),
  dlUpdate: () => dl.updateYtdlp(),
  dlClear: () => dl.clearFinished(),
  thumb: ({ id, title }) => dl.downloadThumbnail(id, title),

  open: ({ route }) => chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html?tab=1#/' + (route || '')) }),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  Promise.resolve(fn(msg))
    .then((data) => sendResponse({ data }))
    .catch((e) => sendResponse({ error: e?.message || String(e), code: e?.code }));
  return true;
});
