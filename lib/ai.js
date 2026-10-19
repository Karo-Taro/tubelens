// Универсальный AI-клиент: любой OpenAI-совместимый эндпоинт или Anthropic Messages API.
import { getSettings } from './storage.js';
import { HELPER_AI } from './presets.js';

const isHelper = (url) => /^http:\/\/(127\.0\.0\.1|localhost):47321(\/|$)/.test(String(url || ''));

export function originPattern(baseUrl) {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.hostname}/*`;
}

// Запрос разрешения на домен AI-эндпоинта (вызывать по клику пользователя)
export async function ensureHostPermission(baseUrl) {
  // помощник TubeLens отвечает с CORS-заголовками — отдельное разрешение не нужно
  if (!chrome.permissions || isHelper(baseUrl)) return true;
  const origins = [originPattern(baseUrl)];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

const trimSlash = (s) => String(s || '').replace(/\/+$/, '');

function buildRequest(cfg, messages, system, opts) {
  const base = trimSlash(cfg.baseUrl);
  const temperature = opts.temperature ?? cfg.temperature;
  const max_tokens = opts.maxTokens ?? cfg.maxTokens;
  if (cfg.format === 'anthropic') {
    return {
      url: base + '/messages',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: { model: cfg.model, max_tokens, temperature, system: system || undefined, messages },
    };
  }
  const headers = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey;
  if (isHelper(base)) headers['X-TubeLens'] = '1';
  if (base.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://github.com/tubelens/tubelens';
    headers['X-Title'] = 'TubeLens';
  }
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
  return { url: base + '/chat/completions', headers, body: { model: cfg.model, messages: msgs, temperature, max_tokens } };
}

function parseResponse(format, j) {
  if (format === 'anthropic') return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return j.choices?.[0]?.message?.content ?? '';
}

/**
 * chat({ messages:[{role,content}], system, temperature, maxTokens })
 * Возвращает текст ответа.
 */
export async function chat({ messages, system, ...opts }) {
  const { ai } = await getSettings();
  if (!ai.baseUrl) throw new Error('AI не настроен: укажите эндпоинт в настройках');
  if (!ai.model) throw new Error('AI не настроен: укажите модель');
  const lang = ai.language ? `\nВсегда отвечай на языке: ${ai.language}.` : '';
  const req = buildRequest(ai, messages, (system || '') + lang, opts);
  let res;
  try {
    res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: opts.signal });
  } catch (e) {
    throw new Error(`Не удалось подключиться к ${req.url}. Проверьте адрес и разрешение на домен (кнопка «Сохранить» в настройках). ${e.message}`);
  }
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { j = null; }
  if (!res.ok) {
    const msg = j?.error?.message || j?.error || j?.message || text.slice(0, 300);
    throw new Error(`AI ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return parseResponse(ai.format, j || {});
}

export async function ask(prompt, system, opts = {}) {
  return chat({ messages: [{ role: 'user', content: prompt }], system, ...opts });
}

// Достаёт JSON из ответа модели (с ```json``` или без)
export function extractJSON(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const src = fenced ? fenced[1] : text;
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error('Модель не вернула JSON');
  const end = Math.max(src.lastIndexOf('}'), src.lastIndexOf(']'));
  return JSON.parse(src.slice(start, end + 1));
}

// Список моделей провайдера (GET /models)
export async function listModels(cfg) {
  const base = trimSlash(cfg.baseUrl);
  const headers = cfg.format === 'anthropic'
    ? { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
    : { ...(cfg.apiKey ? { authorization: 'Bearer ' + cfg.apiKey } : {}), ...(isHelper(base) ? { 'X-TubeLens': '1' } : {}) };
  const res = await fetch(base + '/models', { headers });
  if (!res.ok) throw new Error('Не удалось получить список моделей: HTTP ' + res.status);
  const j = await res.json();
  return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
}
