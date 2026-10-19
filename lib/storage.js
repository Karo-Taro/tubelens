// Хранилище настроек, данных и кэша (chrome.storage.local).

export const DEFAULTS = {
  ytApiKey: '',
  region: 'US',          // regionCode для поиска / трендов
  hl: 'ru',              // язык подсказок и relevanceLanguage
  overlay: true,         // показывать панели на youtube.com
  badges: true,          // бейджи VPH и ×N на карточках видео
  channelPanel: true,    // панель TubeLens на странице канала
  myChannel: '',         // ID своего канала (UC...)
  theme: 'graphite',     // id темы из app/themes.js или 'auto'
  ai: {
    preset: 'openai',
    format: 'openai',    // 'openai' | 'anthropic'
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 2048,
    language: 'Русский',
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(a, b) {
  const out = { ...a };
  for (const k in b) out[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k];
  return out;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return merge(DEFAULTS, settings || {});
}

export async function saveSettings(patch) {
  const next = merge(await getSettings(), patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getData(key, def) {
  const r = await chrome.storage.local.get(key);
  return r[key] ?? def;
}

export async function setData(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// ---- кэш с TTL ----
// Копия в памяти ограничена: сырые ответы InnerTube весят 0.3–0.5 МБ каждый
const mem = new Map();
const MEM_MAX = 150;
function memSet(k, r) {
  mem.delete(k);
  mem.set(k, r);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
}

export async function cacheGet(k) {
  const m = mem.get(k);
  if (m && m.exp > Date.now()) return m.v;
  const key = 'c:' + k;
  const r = (await chrome.storage.local.get(key))[key];
  if (r && r.exp > Date.now()) {
    memSet(k, r);
    return r.v;
  }
  return null;
}

export async function cacheSet(k, v, ttlSec) {
  const r = { v, exp: Date.now() + ttlSec * 1000 };
  memSet(k, r);
  await chrome.storage.local.set({ ['c:' + k]: r });
}

export async function pruneCache(all = false) {
  const items = await chrome.storage.local.get(null);
  const rm = Object.keys(items).filter((k) => k.startsWith('c:') && (all || !(items[k]?.exp > Date.now())));
  if (rm.length) await chrome.storage.local.remove(rm);
  mem.clear();
  return rm.length;
}

// ---- учёт квоты YouTube Data API (10 000 ед./сутки по умолчанию) ----
const today = () => new Date().toISOString().slice(0, 10);

export async function addQuota(units) {
  const q = await getData('quota', { day: today(), used: 0 });
  if (q.day !== today()) Object.assign(q, { day: today(), used: 0 });
  q.used += units;
  await setData('quota', q);
}

export async function getQuota() {
  const q = await getData('quota', { day: today(), used: 0 });
  return q.day === today() ? q.used : 0;
}

// ---- история последних проверок (видео, каналы, запросы) ----
export async function pushRecent(item) {
  const list = (await getData('recent', [])).filter((r) => !(r.type === item.type && r.key === item.key));
  list.unshift({ ...item, at: Date.now() });
  await setData('recent', list.slice(0, 30));
}
export const getRecent = () => getData('recent', []);
