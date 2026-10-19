// Режим без API-ключа: внутренний JSON-API сайта youtube.com (InnerTube).
// Анонимные запросы, как у гостя в режиме инкогнито. Формат ответов YouTube
// может меняться — все разборы собраны здесь, чинить при поломке нужно только этот файл.
import { getSettings, cacheGet, cacheSet } from './storage.js';

const BASE = 'https://www.youtube.com/youtubei/v1/';
const FALLBACK_VERSION = '2.20251015.01.00';

let verLoading = null; // параллельные запросы ждут одну загрузку главной страницы
async function clientVersion() {
  const cached = await cacheGet('it:ver');
  if (cached) return cached;
  verLoading ??= (async () => {
    let ver = FALLBACK_VERSION;
    try {
      const html = await (await fetch('https://www.youtube.com/?hl=en')).text();
      ver = /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1] || /"clientVersion":"([^"]+)"/.exec(html)?.[1] || ver;
    } catch { /* используем запасную версию */ }
    await cacheSet('it:ver', ver, 86400);
    return ver;
  })().finally(() => { verLoading = null; });
  return verLoading;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// hl=en — чтобы числа и даты приходили в разбираемом формате («1.2M views», «2 weeks ago»)
// ttl = 0 — не кэшировать сырой ответ (большие ответы, из которых нужно пара чисел)
async function call(endpoint, body, ttl = 1800) {
  const { region } = await getSettings();
  const ck = 'it:' + endpoint + ':' + JSON.stringify(body) + region;
  const cached = ttl ? await cacheGet(ck) : null;
  if (cached) return cached;
  const context = { client: { clientName: 'WEB', clientVersion: await clientVersion(), hl: 'en', gl: region || 'US' } };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + endpoint + '?prettyPrint=false', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, ...body }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error('YouTube временно ограничил запросы (' + res.status + ')');
      if (!res.ok) {
        // 4xx — повтор не поможет (например, 404 у несуществующего @handle)
        const err = new Error('YouTube: HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      const json = await res.json();
      if (ttl) await cacheSet(ck, json, ttl);
      return json;
    } catch (e) {
      lastErr = e;
      if (e.status) break;
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ---- утилиты разбора ----
// Обход JSON без рекурсии (глубокие ответы YouTube не переполняют стек), порядок — как в документе
function findAll(node, key, out = []) {
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(cur, key)) out.push(cur[key]);
    const vals = Object.values(cur);
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] && typeof vals[i] === 'object') stack.push(vals[i]);
  }
  return out;
}

const text = (t) => (!t ? '' : t.simpleText ?? t.content ?? (t.runs || []).map((r) => r.text).join(''));

export function parseCount(s) {
  if (!s || /^no /i.test(s)) return 0;
  // \b — чтобы «123 members» не превращалось в 123M
  const m = /([\d.,]+)\s*([KMB]\b)?/i.exec(s);
  if (!m) return 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  return mult === 1 ? +m[1].replace(/[.,]/g, '') : Math.round(parseFloat(m[1].replace(/,/g, '')) * mult);
}

// «3 weeks ago» → ISO-дата (приблизительно)
export function parseAgo(s) {
  const m = /(\d+)\s*(second|minute|hour|day|week|month|year)/i.exec(s || '');
  if (!m) return new Date().toISOString();
  const sec = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }[m[2].toLowerCase()];
  return new Date(Date.now() - +m[1] * sec * 1000).toISOString();
}

export function parseClock(s) {
  if (!s || !/^\d/.test(s)) return 0;
  return s.split(':').reduce((acc, x) => acc * 60 + (+x || 0), 0);
}

const thumbOf = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

function fromVideoRenderer(vr) {
  const owner = (vr.ownerText || vr.longBylineText || vr.shortBylineText)?.runs?.[0];
  const pub = text(vr.publishedTimeText);
  return {
    id: vr.videoId,
    title: text(vr.title),
    description: (vr.detailedMetadataSnippets || []).map((d) => text(d.snippetText)).join(' '),
    tags: [],
    // у совместных видео («A and 4 more») вместо ссылки — диалог со списком авторов; берём первого
    channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId ||
      findAll(owner?.navigationEndpoint, 'browseEndpoint').map((b) => b.browseId).find((x) => x?.startsWith('UC')) || '',
    channelTitle: owner?.text || '',
    publishedAt: parseAgo(pub),
    publishedText: pub,
    thumb: thumbOf(vr.videoId),
    thumbHi: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
    duration: parseClock(text(vr.lengthText)),
    views: parseCount(text(vr.viewCountText)),
    likes: null,
    comments: null,
    // эфир сейчас («watching») или запланированная премьера/трансляция («waiting»)
    live: !pub && (/watching|waiting/i.test(text(vr.viewCountText)) || !!vr.upcomingEventData),
    scraped: true,
    approxDate: true,
  };
}

function fromLockup(l, channel = {}) {
  const parts = findAll(l.metadata, 'metadataParts').flat().map((p) => text(p.text));
  const viewsTxt = parts.find((p) => /views?$/i.test(p)) || '';
  const pub = parts.find((p) => /ago$/i.test(p)) || '';
  const badge = findAll(l.contentImage, 'thumbnailBadgeViewModel').map((b) => b.text).find((t) => /^\d+:\d/.test(t || ''));
  return {
    id: l.contentId,
    title: text(l.metadata?.lockupMetadataViewModel?.title),
    description: '',
    tags: [],
    channelId: channel.id || '',
    channelTitle: channel.title || '',
    publishedAt: parseAgo(pub),
    publishedText: pub,
    thumb: thumbOf(l.contentId),
    thumbHi: `https://i.ytimg.com/vi/${l.contentId}/hqdefault.jpg`,
    duration: parseClock(badge),
    views: parseCount(viewsTxt),
    likes: null,
    comments: null,
    // эфир или премьера без даты публикации — иначе 0 просмотров и дата «сейчас» портят медиану и VPH
    live: !pub && parts.some((p) => /watching|waiting|scheduled|premieres?/i.test(p)),
    scraped: true,
    approxDate: true,
  };
}

function collectVideos(json, channel) {
  const out = findAll(json, 'videoRenderer').filter((v) => v.videoId).map(fromVideoRenderer);
  const lockups = findAll(json, 'lockupViewModel').filter((l) => l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO');
  out.push(...lockups.map((l) => fromLockup(l, channel)));
  const seen = new Set();
  return out.filter((v) => !seen.has(v.id) && seen.add(v.id));
}

// Токен подгрузки следующей порции списка (именно у списка, а не у шапки канала)
// (служебные панели страницы — engagementPanels — тоже содержат токены, их пропускаем)
const continuation = (json) => {
  const main = { ...json, engagementPanels: undefined, header: undefined };
  return findAll(main, 'continuationItemRenderer').map((c) => c.continuationEndpoint?.continuationCommand?.token).filter(Boolean).pop() ||
    findAll(main, 'continuationCommand').map((c) => c.token).filter(Boolean).pop();
};

// ---- protobuf-параметр фильтров поиска (sp) ----
function varint(n) {
  const b = [];
  while (n > 127) { b.push((n & 127) | 128); n >>>= 7; }
  b.push(n);
  return b;
}
const field = (num, val) => [...varint(num << 3), ...varint(val)];

/** sort: 0 релевантность, 2 дата, 3 просмотры; date: 1 час, 2 сегодня, 3 неделя, 4 месяц, 5 год */
export function searchParams({ sort = 0, date = 0, type = 1 } = {}) {
  const filt = [...(date ? field(1, date) : []), ...(type ? field(2, type) : [])];
  const msg = [...(sort ? field(1, sort) : []), ...(filt.length ? [(2 << 3) | 2, ...varint(filt.length), ...filt] : [])];
  return btoa(String.fromCharCode(...msg));
}

// ---- публичные функции ----

export async function search(q, { max = 25, sort = 0, date = 0 } = {}) {
  let json = await call('search', { query: q, params: searchParams({ sort, date }) });
  const out = collectVideos(json);
  let token = continuation(json);
  while (out.length < max && token) {
    json = await call('search', { continuation: token });
    const more = collectVideos(json).filter((v) => !out.some((o) => o.id === v.id));
    if (!more.length) break;
    out.push(...more);
    token = continuation(json);
  }
  return out.filter((v) => !v.live).slice(0, max);
}

export async function resolveChannel(input) {
  const url = /^https?:/.test(input) ? input : 'https://www.youtube.com/' + (input.startsWith('@') ? input : '@' + input);
  const json = await call('navigation/resolve_url', { url }, 86400).catch((e) => {
    throw e.status === 404 || e.status === 400 ? new Error('Канал не найден: ' + input) : e;
  });
  const id = json?.endpoint?.browseEndpoint?.browseId;
  if (id?.startsWith('UC')) return id;
  // ссылка на видео → канал автора
  const vid = json?.endpoint?.watchEndpoint?.videoId;
  if (vid) return (await videoDetails(vid)).channelId;
  throw new Error('Канал не найден: ' + input);
}

const VIDEOS_TAB = 'EgZ2aWRlb3PyBgQKAjoA';

export async function channelPage(id, maxVideos = 0) {
  const json = await call('browse', { browseId: id, params: VIDEOS_TAB });
  const meta = json.metadata?.channelMetadataRenderer || {};
  const header = JSON.stringify(json.header || {});
  const subsTxt = /"([\d.,]+[KMB]?) subscribers?"/.exec(header)?.[1] || '';
  const vidsTxt = /"([\d.,]+[KMB]?) videos?"/.exec(header)?.[1] || '';
  const channel = {
    id: meta.externalId || id,
    title: meta.title || '',
    handle: /"(@[^"\s]+)"/.exec(header)?.[1] || meta.vanityChannelUrl?.split('/').pop() || '',
    description: meta.description || '',
    country: '',
    publishedAt: null,
    thumb: meta.avatar?.thumbnails?.[0]?.url || '',
    subs: parseCount(subsTxt),
    subsApprox: true,
    hiddenSubs: !subsTxt,
    views: null, // общее число просмотров канала без ключа недоступно
    videos: parseCount(vidsTxt),
    uploadsId: 'UU' + id.slice(2),
    keywords: meta.keywords || '',
    scraped: true,
  };
  if (!maxVideos) return { channel, videos: [] };
  // У каналов без вкладки «Videos» (тематические, только Shorts) YouTube отдаёт главную —
  // там чужие видео с полок, приписывать их каналу нельзя
  const tabs = json.contents?.twoColumnBrowseResultsRenderer?.tabs;
  if (tabs && !tabs.some((t) => t.tabRenderer?.selected && /^videos$/i.test(t.tabRenderer.title || ''))) return { channel, videos: [] };
  const videos = collectVideos(json, channel);
  let token = continuation(json);
  while (videos.length < maxVideos && token) {
    const more = await call('browse', { continuation: token });
    const add = collectVideos(more, channel).filter((v) => !videos.some((o) => o.id === v.id));
    if (!add.length) break;
    videos.push(...add);
    token = continuation(more);
  }
  return { channel, videos: videos.slice(0, maxVideos) };
}

// «Подробнее о канале»: общие просмотры, дата регистрации, страна (окно открывается продолжением)
export async function channelAbout(id) {
  const json = await call('browse', { browseId: id }, 6 * 3600);
  for (const token of findAll(json, 'continuationCommand').map((c) => c.token).filter(Boolean).slice(0, 6)) {
    const t = JSON.stringify(await call('browse', { continuation: token }, 6 * 3600));
    const views = /"viewCountText":"([^"]+)"/.exec(t)?.[1];
    if (!views) continue;
    return {
      views: parseCount(views),
      joined: /"joinedDateText":\{"content":"Joined ([^"]+)"/.exec(t)?.[1] || '',
      country: /"country":"([^"]+)"/.exec(t)?.[1] || '',
      subs: parseCount(/"subscriberCountText":"([^"]+)"/.exec(t)?.[1] || ''),
    };
  }
  return { views: null, joined: '', country: '', subs: 0 };
}

// Ключевые слова канала: строка вида 'a b "фраза с пробелом"' → массив
export function parseKeywords(s) {
  const out = [];
  String(s || '').replace(/"([^"]+)"|(\S+)/g, (_, q, w) => out.push(q || w));
  return [...new Set(out)];
}

// Точные данные одного видео: просмотры, теги, описание, дата (+ лайки/комментарии при withEngagement)
export async function videoDetails(id, withEngagement = false) {
  const p = await call('player', { videoId: id });
  const d = p.videoDetails;
  if (!d) throw new Error('Видео недоступно: ' + (p.playabilityStatus?.reason || id));
  const mf = p.microformat?.playerMicroformatRenderer || {};
  const v = {
    id,
    title: d.title || '',
    description: d.shortDescription || '',
    tags: d.keywords || [],
    channelId: d.channelId,
    channelTitle: d.author,
    publishedAt: mf.publishDate || mf.uploadDate || new Date().toISOString(),
    category: mf.category,
    thumb: thumbOf(id),
    thumbHi: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    duration: +d.lengthSeconds || 0,
    views: +d.viewCount || 0,
    likes: null,
    comments: null,
    // анонимный player часто UNPLAYABLE и без блока captions — тогда наличие субтитров неизвестно
    caption: p.captions ? true : p.playabilityStatus?.status === 'OK' ? false : null,
    definition: '',
    // lengthSeconds — строка: у идущего эфира это "0" (truthy), поэтому приводим к числу
    live: !!d.isLive || !!d.isUpcoming || (!!d.isLiveContent && !+d.lengthSeconds),
    scraped: true,
    approxDate: false,
  };
  if (withEngagement) {
    try {
      // ответ next весит ~0.5 МБ — кэшируем только два нужных числа
      const ek = 'it:eng:' + id;
      let eng = await cacheGet(ek);
      if (!eng) {
        const n = JSON.stringify(await call('next', { videoId: id }, 0));
        const likes = /along with ([\d,]+) other/.exec(n)?.[1];
        const c = /"contextualInfo":\{"runs":\[\{"text":"([^"]+)"/.exec(n)?.[1];
        eng = { likes: likes ? +likes.replace(/,/g, '') + 1 : null, comments: c ? parseCount(c) : null };
        await cacheSet(ek, eng, 1800);
      }
      v.likes = eng.likes;
      v.comments = eng.comments;
    } catch { /* без лайков */ }
  }
  return v;
}

// Параллельно уточняет данные списка видео (теги, точная дата и просмотры)
export async function enrich(videos, concurrency = 6) {
  const out = [...videos];
  let i = 0;
  const worker = async () => {
    while (i < out.length) {
      const idx = i++;
      try {
        const d = await videoDetails(out[idx].id);
        out[idx] = { ...out[idx], ...d, channelTitle: d.channelTitle || out[idx].channelTitle };
      } catch { /* оставляем приблизительные данные */ }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
