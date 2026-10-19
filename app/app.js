// Роутер приложения (боковая панель и полноэкранная вкладка — один и тот же код).
import { $, esc, errorHtml, icon } from './ui.js';
import { getQuota, getSettings, saveSettings } from '../lib/storage.js';
import { THEMES, AUTO, applyTheme, swatch } from './themes.js';
import { ABOUT } from './about.js';
import * as dashboard from './views/dashboard.js';
import { routeInput } from './views/dashboard.js';
import * as keywords from './views/keywords.js';
import * as video from './views/video.js';
import * as channel from './views/channel.js';
import * as competitors from './views/competitors.js';
import * as trends from './views/trends.js';
import * as ai from './views/ai.js';
import * as coach from './views/coach.js';
import * as downloads from './views/downloads.js';
import * as settings from './views/settings.js';
import * as bulkseo from './views/bulkseo.js';
import * as abtest from './views/abtest.js';
import * as alerts from './views/alerts.js';

const ROUTES = [
  ['dashboard', 'Обзор', 'home', dashboard, 'Анализ'],
  ['keywords', 'Ключевые слова', 'key', keywords],
  ['video', 'Анализ видео', 'play', video],
  ['channel', 'Аудит канала', 'chart', channel],
  ['competitors', 'Конкуренты', 'users', competitors],
  ['trends', 'Аутлаеры', 'trend', trends],
  ['bulkseo', 'SEO моего канала', 'checks', bulkseo],
  ['ai', 'AI-студия', 'sparkles', ai, 'Создание'],
  ['coach', 'AI-коуч', 'message', coach],
  ['abtest', 'A/B-превью', 'layout', abtest],
  ['downloads', 'Загрузки', 'download', downloads, 'Инструменты'],
  ['alerts', 'Уведомления', 'bell', alerts],
  ['settings', 'Настройки', 'settings', settings],
];

const isTab = new URLSearchParams(location.search).has('tab');
if (isTab) $('#fullBtn').remove();
else $('#fullBtn').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html?tab=1') + location.hash }));

if (!isTab) $('#fullBtn').innerHTML = icon('expand', 15);
$('#tgBtn').innerHTML = icon('plane', 16);

// ---- тема ----
const settings0 = await getSettings();
applyTheme(settings0.theme);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
  if ((await getSettings()).theme === 'auto') applyTheme('auto');
});
chrome.storage.onChanged.addListener((ch) => { if (ch.settings) applyTheme(ch.settings.newValue?.theme); });
$('#themeBtn').innerHTML = icon('palette', 16);
$('#themeBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  const old = document.querySelector('.theme-menu');
  if (old) return old.remove();
  const cur = (await getSettings()).theme;
  const menu = document.createElement('div');
  menu.className = 'theme-menu';
  menu.innerHTML = [...THEMES, AUTO].map((t) => `<button data-t="${t.id}" class="${t.id === cur ? 'on' : ''}">${t.c ? swatch(t) : '<span class="swatch" style="background:linear-gradient(135deg,#0f121a 50%,#f6f7f9 50%);border-color:var(--line2)"></span>'}<span>${esc(t.name)}</span>${t.id === cur ? icon('check', 14) : ''}</button>`).join('');
  document.body.append(menu);
  menu.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-t]');
    if (!b) return;
    await saveSettings({ theme: b.dataset.t });
    applyTheme(b.dataset.t);
    menu.remove();
  });
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }));
  menu.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { menu.remove(); $('#themeBtn').focus(); } });
  menu.querySelector('.on, button')?.focus();
});
// ---- командная строка: ссылка на видео, канал или запрос — с любой страницы; «/» ставит фокус ----
$('#cmdIc').outerHTML = icon('search', 16);
$('#cmd').addEventListener('submit', (e) => {
  e.preventDefault();
  const r = routeInput($('#cmdInput').value);
  if (!r) return;
  $('#cmdInput').value = '';
  $('#cmdInput').blur();
  location.hash = '#/' + r[0] + '?' + new URLSearchParams(r[1]);
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { e.preventDefault(); $('#cmdInput').focus(); }
});

$('#nav').innerHTML = ROUTES.map(([id, title, ic, , group]) =>
  (group ? `<div class="group">${esc(group)}</div>` : '') + `<a href="#/${id}" data-id="${id}">${icon(ic, 17)}<span>${esc(title)}</span></a>`).join('');
// подпись проекта внизу меню
$('#nav').insertAdjacentHTML('beforeend', `<div class="credit">
  <a href="${ABOUT.telegram}" target="_blank" rel="noopener" title="Telegram-канал ${esc(ABOUT.author)}">${icon('plane', 15)}<span>by <b>${esc(ABOUT.author)}</b></span></a>
  <a href="${ABOUT.github}" target="_blank" rel="noopener" title="Исходный код на GitHub">${icon('code', 15)}<span>GitHub</span></a></div>`);

function parseHash() {
  const [name, qs] = location.hash.replace(/^#\/?/, '').split('?');
  return { name: name || 'dashboard', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

let renderId = 0;
async function render() {
  const id = ++renderId;
  const { name, params } = parseHash();
  const route = ROUTES.find((r) => r[0] === name) || ROUTES[0];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.id === route[0]));
  // свой контейнер на каждый рендер: «опоздавший» рендер прошлого маршрута пишет в отсоединённый узел, а не в текущий экран
  const root = document.createElement('div');
  $('#view').replaceChildren(root);
  try {
    await route[3].render(root, params, () => id !== renderId);
  } catch (e) {
    console.error(e);
    if (id === renderId) root.innerHTML = errorHtml(e);
  }
  updateQuota();
}

async function updateQuota() {
  const used = await getQuota();
  $('#quota').textContent = used ? `квота API ${used} / 10 000` : '';
}

window.addEventListener('hashchange', render);
chrome.storage.onChanged.addListener((ch) => { if (ch.quota) updateQuota(); });
render();
