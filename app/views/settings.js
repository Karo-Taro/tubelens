import { $, esc, bg, icon, pageHead, toast, loadingHtml, errorHtml } from '../ui.js';
import { getSettings, saveSettings, pruneCache, DEFAULTS } from '../../lib/storage.js';
import { AI_PRESETS, presetById } from '../../lib/presets.js';
import { THEMES, AUTO, applyTheme, swatch } from '../themes.js';
import { ABOUT } from '../about.js';
import { ask, listModels, ensureHostPermission } from '../../lib/ai.js';
import { resolveChannelId, REGIONS } from '../../lib/youtube.js';

export async function render(root) {
  const s = await getSettings();
  const sec = (id, title, desc, body) => `<section class="v-set-sec" aria-labelledby="sec_${id}">
      <div class="v-set-meta"><h2 id="sec_${id}">${title}</h2>${desc}</div>
      <div class="v-set-body">${body}</div></section>`;
  const opt = (id, on, title, desc) => `<label class="check v-set-opt"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}>
      <span><b>${title}</b><span class="muted small">${desc}</span></span></label>`;

  root.innerHTML = `<div class="v-settings">${pageHead('Настройки', 'Источник данных YouTube, AI-провайдер, оформление и поведение на youtube.com. Всё хранится локально в этом браузере.')}
  <form id="f">
    ${sec('yt', 'YouTube', '<p>Данные берутся с публичного сайта YouTube — ключи и регистрация не нужны.</p>', `
      <div class="v-set-cols">
        <div><label for="region">Регион поиска</label><select id="region">${REGIONS.map((r) => `<option ${r === s.region ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        <div><label for="hl">Язык подсказок (код)</label><input id="hl" value="${esc(s.hl)}" placeholder="ru, uk, en…"></div>
      </div>
      <label for="myChannel">Мой канал (@handle, ссылка или ID)</label><input id="myChannel" value="${esc(s.myChannel)}" placeholder="@mychannel">
      <p class="v-set-hint">Нужен для аудита, коуча и сравнения с конкурентами.</p>`)}

    ${sec('ai', 'AI-провайдер', `<p>Пресет или любой OpenAI-совместимый эндпоинт. Ключ хранится только локально.</p>
      <div class="v-set-active" id="activeAi" aria-live="polite"></div>`, `
      <label for="preset">Пресет</label><select id="preset">${AI_PRESETS.map((p) => `<option value="${p.id}" ${p.id === s.ai.preset ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <div id="presetNote" class="v-set-note"></div>
      <div class="v-set-cols">
        <div><label for="format">Формат API</label><select id="format"><option value="openai">OpenAI-совместимый (/chat/completions)</option><option value="anthropic">Anthropic (/messages)</option></select></div>
        <div><label for="baseUrl">Base URL эндпоинта</label><input id="baseUrl" class="mono" value="${esc(s.ai.baseUrl)}" placeholder="https://…/v1"></div>
      </div>
      <label for="aiKey">API-ключ <span id="keyOpt" class="v-set-tag"></span></label><input id="aiKey" type="password" value="${esc(s.ai.apiKey)}" autocomplete="off">
      <label for="model">Модель</label><div class="v-set-inline"><input id="model" class="mono" list="models" value="${esc(s.ai.model)}"><datalist id="models"></datalist>
        <button type="button" class="btn ghost" id="loadModels">${icon('refresh', 15)} Загрузить список</button></div>
      <div class="v-set-cols three">
        <div><label for="temp">Температура</label><input id="temp" class="mono" type="number" min="0" max="2" step="0.1" value="${s.ai.temperature}"></div>
        <div><label for="maxTokens">Макс. токенов</label><input id="maxTokens" class="mono" type="number" min="256" step="256" value="${s.ai.maxTokens}"></div>
        <div><label for="aiLang">Язык ответов</label><input id="aiLang" value="${esc(s.ai.language)}"></div>
      </div>
      <div class="v-set-test"><button type="button" class="btn ghost" id="test">${icon('activity', 15)} Проверить подключение</button>
        <div id="testOut"></div></div>`)}

    ${sec('look', 'Оформление', '<p>Тема применяется сразу. Свою можно добавить в <code>app/themes.js</code>.</p>', `
      <div class="theme-grid" id="themes">${[...THEMES, AUTO].map((t) => `<button type="button" class="theme-card ${t.id === s.theme ? 'on' : ''}" data-t="${t.id}" aria-pressed="${t.id === s.theme}">${t.c ? swatch(t) : '<span class="swatch" style="background:linear-gradient(135deg,#0f121a 50%,#f6f7f9 50%);border-color:var(--line2)"></span>'}${esc(t.name)}</button>`).join('')}</div>`)}

    ${sec('site', 'На сайте YouTube', '<p>Что TubeLens добавляет прямо на youtube.com.</p>', `
      ${opt('overlay', s.overlay, 'Панель TubeLens', 'На страницах видео, поиска и каналов')}
      ${opt('badges', s.badges !== false, 'Бейджи на карточках видео', '«Просмотров в час» и множитель ×N — без запросов, по данным страницы')}
      ${opt('cpanel', s.channelPanel !== false, 'Панель канала справа', 'Подписчики, просмотры, график, теги, AI')}`)}

    ${sec('data', 'Данные', '<p>Перенос настроек между браузерами и очистка кэша ответов YouTube.</p>', `
      <div class="v-set-data">
        <div><b>Экспорт настроек</b><span class="muted small">JSON-файл без API-ключей</span></div><button type="button" class="btn ghost sm" id="export">Экспорт</button>
        <div><b>Импорт настроек</b><span class="muted small">Из ранее сохранённого файла</span></div><button type="button" class="btn ghost sm" id="import">Импорт</button>
        <div><b>Кэш</b><span class="muted small">Данные подтянутся заново при следующем запросе</span></div><button type="button" class="btn ghost sm" id="clearCache">Очистить кэш</button>
      </div>`)}

    ${sec('about', 'О проекте', `<p>TubeLens ${esc(ABOUT.version)} — бесплатный инструмент с открытым кодом (MIT).</p>`, `
      <div class="v-set-data">
        <div><b>by ${esc(ABOUT.author)}</b><span class="muted small">Новости, обновления и фишки для YouTube — в Telegram-канале</span></div>
        <a class="btn ghost sm" href="${ABOUT.telegram}" target="_blank" rel="noopener">${icon('plane', 14)} Telegram</a>
        <div><b>Исходный код</b><span class="muted small">Звёзды, баг-репорты и pull request'ы приветствуются</span></div>
        <a class="btn ghost sm" href="${ABOUT.github}" target="_blank" rel="noopener">${icon('code', 14)} GitHub</a>
        <div><b>Нашли ошибку?</b><span class="muted small">Опишите, что случилось, и приложите скриншот</span></div>
        <a class="btn ghost sm" href="${ABOUT.issues}" target="_blank" rel="noopener">Сообщить</a>
      </div>`)}

    <div class="v-set-savebar">
      <span class="muted small">Тема сохраняется сразу, остальное — по кнопке</span>
      <button class="btn">${icon('check', 15)} Сохранить</button>
    </div>
  </form></div>`;

  const f = $('#f', root);
  $('#themes', f).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    await saveSettings({ theme: b.dataset.t });
    applyTheme(b.dataset.t);
    f.querySelectorAll('.theme-card').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
  });
  $('#format', f).value = s.ai.format;
  const fillModels = (list) => ($('#models', f).innerHTML = list.map((m) => `<option value="${esc(m)}">`).join(''));
  const showActive = () => {
    const p = presetById($('#preset', f).value);
    const saved = p.id === s.ai.preset && $('#model', f).value.trim() === s.ai.model;
    $('#activeAi', f).innerHTML = `<span class="dot ${saved ? 'on' : ''}" aria-hidden="true"></span>
      <span><b>${esc(p.id === 'custom' ? 'Свой эндпоинт' : p.name.replace(/\s*\(.*\)$/, ''))}</b>
      <span class="mono">${esc($('#model', f).value.trim() || '—')}</span>
      <span class="state">${saved ? 'активен' : 'не сохранено'}</span></span>`;
  };
  const showNote = (p) => {
    const parts = [p.keyUrl ? `<a target="_blank" href="${esc(p.keyUrl)}">${p.noKey ? 'Сайт проекта' : 'Получить ключ'} ${icon('external', 12)}</a>` : '', esc(p.note || '')].filter(Boolean);
    $('#presetNote', f).innerHTML = parts.length ? `${icon('alert', 14)}<span>${parts.join(' · ')}</span>` : '';
    $('#presetNote', f).hidden = !parts.length;
    $('#keyOpt', f).textContent = p.noKey ? 'не обязателен' : '';
    showActive();
  };
  $('#model', f).addEventListener('input', showActive);
  showNote(presetById(s.ai.preset));
  fillModels(presetById(s.ai.preset).models);

  $('#preset', f).addEventListener('change', (e) => {
    const p = presetById(e.target.value);
    $('#format', f).value = p.format;
    if (p.id !== 'custom') $('#baseUrl', f).value = p.baseUrl;
    if (p.models[0]) $('#model', f).value = p.models[0];
    fillModels(p.models);
    showNote(p);
  });

  const collect = () => ({
    region: $('#region', f).value,
    hl: $('#hl', f).value.trim() || 'ru',
    overlay: $('#overlay', f).checked,
    badges: $('#badges', f).checked,
    channelPanel: $('#cpanel', f).checked,
    ai: {
      preset: $('#preset', f).value,
      format: $('#format', f).value,
      baseUrl: $('#baseUrl', f).value.trim(),
      apiKey: $('#aiKey', f).value.trim(),
      model: $('#model', f).value.trim(),
      temperature: +$('#temp', f).value || 0.7,
      maxTokens: +$('#maxTokens', f).value || 2048,
      language: $('#aiLang', f).value.trim(),
    },
  });

  // Сохранение: запрашиваем доступ к домену AI-эндпоинта (нужен жест пользователя)
  const save = async () => {
    const next = collect();
    if (next.ai.baseUrl) {
      try { new URL(next.ai.baseUrl); } catch { throw new Error('Некорректный Base URL'); }
      const granted = await ensureHostPermission(next.ai.baseUrl);
      if (!granted) toast('Без разрешения на домен запросы к AI работать не будут', true);
    }
    const mc = $('#myChannel', f).value.trim();
    await saveSettings(next);
    if (mc && mc !== s.myChannel) {
      try { next.myChannel = await resolveChannelId(mc); } catch (e) { toast('Канал: ' + e.message, true); next.myChannel = ''; }
      $('#myChannel', f).value = next.myChannel;
    } else next.myChannel = mc;
    await saveSettings({ myChannel: next.myChannel });
    Object.assign(s, next);
    showActive();
  };

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await save(); toast('Сохранено'); } catch (err) { toast(err.message, true); }
  });

  $('#test', f).addEventListener('click', async () => {
    const out = $('#testOut', f);
    try {
      await save();
      out.innerHTML = loadingHtml('Отправляю тестовый запрос…');
      const text = await ask('Ответь одним коротким предложением: ты на связи?', '', { maxTokens: 60 });
      out.innerHTML = `<div class="good">Подключение работает. Ответ модели: ${esc(text.slice(0, 200))}</div>`;
    } catch (e) { out.innerHTML = errorHtml(e); }
  });

  $('#loadModels', f).addEventListener('click', async () => {
    try {
      const cfg = collect().ai;
      await ensureHostPermission(cfg.baseUrl);
      const list = await listModels(cfg);
      fillModels(list);
      toast(`Найдено моделей: ${list.length}`);
    } catch (e) { toast(e.message, true); }
  });

  $('#export', f).addEventListener('click', async () => {
    const data = await getSettings();
    const blob = new Blob([JSON.stringify({ ...data, ytApiKey: '', ai: { ...data.ai, apiKey: '' } }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'tubelens-settings.json' });
    a.click();
    toast('Экспортировано (без ключей)');
  });

  $('#import', f).addEventListener('click', () => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
    inp.onchange = async () => {
      try {
        const data = JSON.parse(await inp.files[0].text());
        const clean = Object.fromEntries(Object.entries(data).filter(([k]) => k in DEFAULTS));
        // экспорт пишет ключи пустыми — пустые значения не должны затирать сохранённые ключи
        if (!clean.ytApiKey) delete clean.ytApiKey;
        if (clean.ai && typeof clean.ai === 'object' && !clean.ai.apiKey) delete clean.ai.apiKey;
        await saveSettings(clean);
        toast('Импортировано');
        render(root);
      } catch (e) { toast('Ошибка импорта: ' + e.message, true); }
    };
    inp.click();
  });

  // кэш чистит service worker (его кэш в памяти иначе остаётся); если фон недоступен — чистим хранилище здесь
  $('#clearCache', f).addEventListener('click', async () => {
    let n;
    try { n = await bg('clearCache'); } catch { n = await pruneCache(true); }
    toast(`Удалено записей кэша: ${n ?? 0}`);
  });
}
