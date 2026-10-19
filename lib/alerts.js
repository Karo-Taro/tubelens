// «Уведомления»: правила трендов (аутлаеры в нише, новые/взлетевшие видео конкурентов, рубежи своего канала).
// Работает и в service worker (по chrome.alarms), и из страницы приложения (проверка «сейчас» через сообщение).
// Всё состояние — в chrome.storage.local: service worker MV3 может быть остановлен в любой момент.
import { getSettings, getData, setData, cacheGet, cacheSet } from './storage.js';
import * as it from './innertube.js';
import { median, vph } from './scoring.js';

export const ALARM = 'tl-alerts';
export const INTERVALS = [30, 60, 180, 360];           // минуты: 30 мин / 1 ч / 3 ч / 6 ч
export const PERMS = { permissions: ['alarms', 'notifications'] };

const K = { rules: 'alerts', config: 'alertsConfig', history: 'alertHistory', seen: 'alertSeen', state: 'alertState', notif: 'alertNotifMap', unread: 'alertUnread' };
const SEEN_CAP = 500, HISTORY_CAP = 100, NOTIF_CAP = 50, PER_RULE_NOTIFY = 3;

export const TYPES = {
  niche: { title: 'Аутлаер в нише', icon: 'trend', defaults: { q: '', days: 3, ratio: 3, vph: 300, minViews: 500 } },
  newVideo: { title: 'Новое видео конкурента', icon: 'users', defaults: { useCompetitors: true, channels: [] } },
  spike: { title: 'Взлёт видео конкурента', icon: 'zap', defaults: { useCompetitors: true, channels: [], k: 3, days: 14 } },
  milestone: { title: 'Мой канал: рубеж', icon: 'target', defaults: { metric: 'subs', mode: 'round', pct: 10 } },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ytUrl = (id) => 'https://www.youtube.com/watch?v=' + id;
const hours = (iso) => Math.max(1, (Date.now() - new Date(iso).getTime()) / 36e5);
export function fmtN(n) {
  if (n == null || !Number.isFinite(+n)) return '—';
  const a = Math.abs(n), f = (x, s) => x.toFixed(1).replace(/\.0$/, '') + s;
  return a >= 1e9 ? f(n / 1e9, 'B') : a >= 1e6 ? f(n / 1e6, 'M') : a >= 1e3 ? f(n / 1e3, 'K') : String(Math.round(n));
}

// ---- хранилище ----
export const getRules = () => getData(K.rules, []);
export const saveRules = (list) => setData(K.rules, list);
export async function getConfig() { return { enabled: false, minutes: 60, ...(await getData(K.config, {})) }; }
export async function saveConfig(patch) { const c = { ...(await getConfig()), ...patch }; await setData(K.config, c); return c; }
export const getHistory = () => getData(K.history, []);

export function newRule(type, params = {}) {
  if (!TYPES[type]) throw new Error('Неизвестный тип уведомления: ' + type);
  return { id: Math.random().toString(36).slice(2, 10), type, enabled: true, params: { ...TYPES[type].defaults, ...params }, createdAt: Date.now() };
}

export function describe(rule) {
  const p = rule.params || {};
  const src = () => [p.useCompetitors ? 'конкуренты' : '', p.channels?.length ? `+${p.channels.length} канал(ов)` : ''].filter(Boolean).join(', ') || 'каналы не выбраны';
  switch (rule.type) {
    case 'niche': return `«${p.q}» · за ${p.days} дн. · просм./подп. ≥ ${p.ratio} или ${p.vph ? `≥ ${p.vph} просм./ч` : 'VPH выкл.'}${p.minViews ? ` · от ${fmtN(p.minViews)} просм.` : ''}`;
    case 'newVideo': return src();
    case 'spike': return `${src()} · ≥ ×${p.k} к медиане · видео за ${p.days} дн.`;
    case 'milestone': return `${p.metric === 'views' ? 'просмотры' : p.metric === 'both' ? 'подписчики и просмотры' : 'подписчики'} · ${p.mode === 'pct' ? `каждые +${p.pct}%` : 'круглые числа'}`;
    default: return '';
  }
}

// ---- разрешения (опциональные: alarms, notifications) ----
export async function hasPerms() {
  try { return !!(await chrome.permissions?.contains(PERMS)); } catch { return false; }
}

// ---- данные каналов ----
// Тот же ключ и формат, что у channelBrief в background.js — кэш общий
async function channelBrief(id) {
  const ck = 'brief:' + id;
  const cached = await cacheGet(ck);
  if (cached) return cached;
  const { channel, videos } = await it.channelPage(id, 30);
  const r = { id, subs: channel.subs, title: channel.title, thumb: channel.thumb, median: median(videos.filter((v) => !v.live).map((v) => v.views)) };
  await cacheSet(ck, r, 3 * 3600);
  return r;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); }
  }));
  return out;
}

async function ruleChannels(p) {
  const ids = [...(p.channels || [])];
  if (p.useCompetitors) ids.push(...(await getData('competitors', [])));
  return [...new Set(ids.filter((x) => /^UC[\w-]{22}$/.test(x)))].slice(0, 30);
}

const videoItem = (v, extra = {}) => ({
  videoId: v.id, url: ytUrl(v.id), thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
  videoTitle: v.title, channelTitle: v.channelTitle || '', views: v.views, vph: Math.round(vph(v)), publishedText: v.publishedText || '', ...extra,
});

// ---- проверки по типам. Возвращают { items, state } — items: кандидаты с уникальным key ----
const CHECKS = {
  async niche(p) {
    const q = String(p.q || '').trim();
    if (!q) throw new Error('Не задан запрос');
    const days = +p.days || 3;
    // фильтр YouTube по дате: 2 — сегодня, 3 — неделя, 4 — месяц
    const found = await it.search(q, { max: 30, sort: 2, date: days <= 1 ? 2 : days <= 7 ? 3 : 4 });
    const fresh = found.filter((v) => hours(v.publishedAt) <= days * 24 + 1 && v.views >= (+p.minViews || 0));
    const ids = [...new Set(fresh.map((v) => v.channelId).filter(Boolean))].slice(0, 15);
    const briefs = new Map((await mapLimit(ids, 3, channelBrief)).filter(Boolean).map((b) => [b.id, b]));
    const items = [];
    for (const v of fresh) {
      const ch = briefs.get(v.channelId);
      const ratio = ch?.subs ? v.views / ch.subs : null;
      const speed = vph(v);
      const byRatio = ratio != null && ratio >= (+p.ratio || Infinity);
      const byVph = +p.vph > 0 && speed >= +p.vph;
      if (!byRatio && !byVph) continue;
      items.push(videoItem(v, {
        key: 'v:' + v.id, ratio, subs: ch?.subs ?? null,
        title: `Аутлаер в нише «${q}»`,
        message: `${v.title}\n${v.channelTitle || ''} · ${fmtN(v.views)} просм.${ratio != null ? ` · ×${ratio.toFixed(1)} к подписчикам` : ''} · ${fmtN(speed)}/ч`,
      }));
    }
    return { items: items.sort((a, b) => (b.ratio || 0) - (a.ratio || 0)) };
  },

  async newVideo(p, state = {}, { dry } = {}) {
    const ids = await ruleChannels(p);
    if (!ids.length) throw new Error('Нет каналов: добавьте конкурентов или каналы в правило');
    const last = { ...(state.last || {}) };
    const items = [];
    for (const id of ids) {
      const { channel, videos } = await it.channelPage(id, 15).catch(() => ({ videos: null }));
      if (!videos) continue;
      const vids = videos.filter((v) => !v.live);
      const prev = last[id];
      // первый проход по каналу — только запоминаем (иначе «новыми» окажутся все видео); в ручной проверке — видео за 3 дня
      const fresh = prev ? vids.filter((v) => !prev.includes(v.id) && hours(v.publishedAt) <= 7 * 24) : dry ? vids.filter((v) => hours(v.publishedAt) <= 72) : [];
      for (const v of fresh) {
        items.push(videoItem({ ...v, channelTitle: v.channelTitle || channel.title }, {
          key: 'new:' + v.id,
          title: `Новое видео: ${channel.title}`,
          message: `${v.title}\n${fmtN(v.views)} просм. · ${fmtN(vph(v))}/ч · ${v.publishedText || 'только что'}`,
        }));
      }
      last[id] = [...new Set([...vids.map((v) => v.id), ...(prev || [])])].slice(0, 40);
      await sleep(250);
    }
    return { items, state: { last } };
  },

  async spike(p) {
    const ids = await ruleChannels(p);
    if (!ids.length) throw new Error('Нет каналов: добавьте конкурентов или каналы в правило');
    const k = +p.k || 3, days = +p.days || 14;
    const items = [];
    for (const id of ids) {
      const { channel, videos } = await it.channelPage(id, 30).catch(() => ({ videos: null }));
      if (!videos) continue;
      const vids = videos.filter((v) => !v.live);
      const med = median(vids.map((v) => v.views));
      if (!med) continue;
      for (const v of vids.filter((x) => hours(x.publishedAt) <= days * 24 && x.views / med >= k)) {
        const out = v.views / med;
        items.push(videoItem({ ...v, channelTitle: v.channelTitle || channel.title }, {
          key: 'spike:' + v.id, out,
          title: `Взлёт ×${out.toFixed(1)}: ${channel.title}`,
          message: `${v.title}\n${fmtN(v.views)} просм. при медиане ${fmtN(med)} · ${fmtN(vph(v))}/ч`,
        }));
      }
      await sleep(250);
    }
    return { items: items.sort((a, b) => b.out - a.out) };
  },

  async milestone(p, state = {}) {
    const { myChannel } = await getSettings();
    if (!myChannel) throw new Error('Не указан свой канал (Настройки)');
    const { channel } = await it.channelPage(myChannel, 0);
    const cur = { subs: channel.subs || null };
    if (p.metric !== 'subs') cur.views = (await it.channelAbout(myChannel).catch(() => ({}))).views ?? null;
    const base = { ...(state.base || {}) };
    const items = [];
    const url = 'https://www.youtube.com/channel/' + myChannel;
    for (const m of p.metric === 'both' ? ['subs', 'views'] : [p.metric === 'views' ? 'views' : 'subs']) {
      const v = cur[m];
      if (!v) continue;
      const name = m === 'subs' ? 'подписчиков' : 'просмотров';
      const prev = base[m];
      if (p.mode === 'pct') {
        const step = Math.max(1, +p.pct || 10) / 100;
        if (prev && v >= prev * (1 + step)) {
          items.push({ key: `ms:${m}:pct:${v}`, url, title: `${channel.title}: +${Math.round((v / prev - 1) * 100)}% ${name}`, message: `${fmtN(prev)} → ${fmtN(v)} ${name}` });
          base[m] = v;
        } else if (!prev) base[m] = v;
      } else {
        const hit = prev ? roundMilestone(prev, v) : null;
        if (hit) items.push({ key: `ms:${m}:${hit}`, url, title: `${channel.title}: ${fmtN(hit)} ${name}!`, message: `Канал перешёл рубеж ${fmtN(hit)} ${name} (сейчас ${fmtN(v)}).` });
        base[m] = v;
      }
    }
    return { items, state: { base }, current: cur };
  },
};

// Ряд «круглых» рубежей: 100, 250, 500, 1K, 2.5K, 5K, 10K…; возвращает наибольший пройденный между prev и cur
const MILESTONES = [];
for (let e = 2; e <= 10; e++) for (const m of [1, 2.5, 5]) MILESTONES.push(m * 10 ** e);
export function roundMilestone(prev, cur) {
  return MILESTONES.filter((x) => x > prev && x <= cur).pop() || null;
}

// ---- уведомления ----
async function pushHistory(entries) {
  if (!entries.length) return;
  const list = await getHistory();
  await setData(K.history, [...entries, ...list].slice(0, HISTORY_CAP));
  const unread = (await getData(K.unread, 0)) + entries.length;
  await setData(K.unread, unread);
  setBadge(unread);
}

export function setBadge(n) {
  try {
    chrome.action?.setBadgeText({ text: n > 0 ? String(n > 99 ? '99+' : n) : '' });
    if (n > 0) chrome.action?.setBadgeBackgroundColor?.({ color: '#f2a93b' });
  } catch { /* нет chrome.action вне расширения */ }
}

export async function markRead() {
  await setData(K.unread, 0);
  setBadge(0);
}

async function showNotification(n) {
  if (!chrome.notifications?.create || !(await hasPerms())) return null;
  const nid = 'tl-alert-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    await chrome.notifications.create(nid, {
      type: 'basic', iconUrl: chrome.runtime?.getURL ? chrome.runtime.getURL('icons/icon128.png') : 'icons/icon128.png',
      title: String(n.title).slice(0, 120), message: String(n.message || '').slice(0, 300), priority: 1,
    });
  } catch (e) { console.warn('[TubeLens] уведомление:', e); return null; }
  if (n.url) {
    const map = await getData(K.notif, {});
    map[nid] = n.url;
    const keys = Object.keys(map);
    for (const k of keys.slice(0, Math.max(0, keys.length - NOTIF_CAP))) delete map[k];
    await setData(K.notif, map);
  }
  return nid;
}

// Клик по уведомлению → URL (и удаление из карты)
export async function urlForNotification(nid) {
  const map = await getData(K.notif, {});
  const url = map[nid];
  if (url) { delete map[nid]; await setData(K.notif, map); }
  return url || null;
}

// ---- запуск ----
let running = null;

/**
 * Проверка правил.
 *  dry=true (кнопка «Проверить сейчас»): возвращает найденное, ничего не уведомляет и не меняет состояние,
 *    у каждого элемента — флаг seen (уже было в уведомлениях).
 *  dry=false (по расписанию): новые элементы → системные уведомления + история; запоминает показанное.
 */
export async function runChecks({ id = null, dry = false } = {}) {
  if (running && !dry) return running;
  const job = (async () => {
    const rules = (await getRules()).filter((r) => (id ? r.id === id : r.enabled));
    if (id && !rules.length) throw new Error('Правило не найдено');
    const states = await getData(K.state, {});
    const seen = new Set(await getData(K.seen, []));
    const results = [];
    for (const [i, rule] of rules.entries()) {
      if (i) await sleep(dry ? 200 : 1500); // разносим запросы правил во времени
      const res = { id: rule.id, type: rule.type, items: [], error: null, fresh: 0 };
      try {
        const out = await CHECKS[rule.type](rule.params || {}, states[rule.id] || {}, { dry });
        res.items = out.items.map((x) => ({ ...x, seen: seen.has(x.key) }));
        if (out.current) res.current = out.current;
        if (!dry) {
          if (out.state) states[rule.id] = { ...(states[rule.id] || {}), ...out.state };
          const fresh = res.items.filter((x) => !x.seen);
          res.fresh = fresh.length;
          const at = Date.now();
          fresh.forEach((x) => seen.add(x.key));
          await pushHistory(fresh.map((x) => ({ key: x.key, at, ruleId: rule.id, type: rule.type, title: x.title, message: x.message, url: x.url, thumb: x.thumb || '' })));
          for (const x of fresh.slice(0, PER_RULE_NOTIFY)) await showNotification(x);
          if (fresh.length > PER_RULE_NOTIFY) {
            await showNotification({ title: TYPES[rule.type].title, message: `И ещё ${fresh.length - PER_RULE_NOTIFY} — см. историю в TubeLens`, url: chrome.runtime?.getURL ? chrome.runtime.getURL('app/app.html?tab=1#/alerts') : '' });
          }
        }
      } catch (e) {
        res.error = e?.message || String(e);
      }
      results.push(res);
      if (!dry) {
        const list = await getRules();
        const r = list.find((x) => x.id === rule.id);
        if (r) { Object.assign(r, { lastRun: Date.now(), lastFound: res.fresh, lastError: res.error }); await saveRules(list); }
      }
    }
    if (!dry) {
      await setData(K.state, states);
      await setData(K.seen, [...seen].slice(-SEEN_CAP));
      await saveConfig({ lastRun: Date.now() });
    }
    return results;
  })();
  if (!dry) running = job.finally(() => { running = null; });
  return dry ? job : running;
}

// Удалить правило вместе с его состоянием
export async function deleteRule(id) {
  await saveRules((await getRules()).filter((r) => r.id !== id));
  const states = await getData(K.state, {});
  delete states[id];
  await setData(K.state, states);
}

// ---- расписание (только в service worker / при наличии разрешения) ----
export async function schedule({ enabled, minutes } = {}) {
  const cfg = await saveConfig({ ...(enabled != null ? { enabled: !!enabled } : {}), ...(minutes ? { minutes: INTERVALS.includes(+minutes) ? +minutes : 60 } : {}) });
  const granted = await hasPerms();
  if (!chrome.alarms) return { ...cfg, granted, scheduled: false };
  await chrome.alarms.clear(ALARM);
  if (cfg.enabled && granted) {
    // первая проверка — через пару минут, дальше с выбранным интервалом
    await chrome.alarms.create(ALARM, { delayInMinutes: Math.min(2, cfg.minutes), periodInMinutes: cfg.minutes });
  }
  const a = await chrome.alarms.get(ALARM);
  return { ...cfg, granted, scheduled: !!a, next: a?.scheduledTime || null };
}

export async function status() {
  const cfg = await getConfig();
  const granted = await hasPerms();
  let next = null;
  try { next = chrome.alarms ? (await chrome.alarms.get(ALARM))?.scheduledTime || null : null; } catch { /* нет API */ }
  return { ...cfg, granted, scheduled: !!next, next, unread: await getData(K.unread, 0) };
}
