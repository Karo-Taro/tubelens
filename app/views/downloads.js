import { $, esc, fmt, bg, icon, pageHead, toast } from '../ui.js';
import { getData } from '../../lib/storage.js';
import { PRESETS } from '../../lib/downloader.js';

const EXT_ID = chrome.runtime.id;

// Состояние задачи: иконка + текст (не только цвет)
const STATE = {
  running: ['download', 'Загрузка', 'run'],
  done: ['check', 'Готово', 'ok'],
  error: ['alert', 'Ошибка', 'err'],
  cancelled: ['x', 'Отменено', 'off'],
};

export async function render(root, params, isStale) {
  root.innerHTML = `<div class="v-downloads">${pageHead('Загрузки', 'Видео и аудио с YouTube через yt-dlp. Файлы сохраняются в папку «Загрузки/TubeLens».',
    `<button type="button" class="btn ghost sm" id="folder">${icon('folder', 14)} Папка загрузок</button>`)}
    <div id="helper" class="v-dl-helper" aria-live="polite"><div class="v-dl-status"><span class="v-dl-dot wait" aria-hidden="true"></span><b>Проверяю помощник загрузки…</b></div></div>
    <form class="card v-dl-form" id="f">
      <div class="v-dl-fields">
        <div class="u"><label for="url">Ссылка на видео</label><input id="url" value="${esc(params.url || '')}" placeholder="https://www.youtube.com/watch?v=…" inputmode="url"></div>
        <div class="p"><label for="preset">Формат</label><select id="preset">${PRESETS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
      </div>
      <div class="v-dl-actions"><button class="btn">${icon('download', 15)} Скачать</button>
        <button type="button" class="btn ghost" id="thumb">${icon('image', 15)} Скачать обложку</button></div>
    </form>
    <p class="v-dl-legal">${icon('scale', 14)}<span>Скачивайте только свои видео или контент, на который у вас есть права. Соблюдайте авторское право и условия использования YouTube.</span></p>
    <div class="section-head"><h2>Задачи</h2><span class="muted small mono" id="jobCount"></span><button type="button" class="btn ghost sm" id="clear">Очистить завершённые</button></div>
    <div id="jobs"></div></div>`;

  const title = params.title || '';
  $('#f', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('#url', root).value.trim();
    if (!url) return;
    try {
      await bg('dlStart', { url, preset: $('#preset', root).value, title });
      toast('Загрузка начата');
    } catch (err) { toast(err.message, true); }
  });
  $('#thumb', root).addEventListener('click', async () => {
    const m = /(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/.exec($('#url', root).value);
    if (!m) return toast('Укажите ссылку на видео', true);
    try { await bg('thumb', { id: m[1], title }); toast('Обложка скачивается'); } catch (err) { toast(err.message, true); }
  });
  $('#clear', root).addEventListener('click', () => bg('dlClear'));
  $('#folder', root).addEventListener('click', () => bg('dlOpen', {}).catch((e) => toast(e.message, true)));

  const drawJobs = async () => {
    if (isStale()) return chrome.storage.onChanged.removeListener(onChange);
    const jobs = await getData('downloads', []);
    const el = $('#jobs', root);
    if (!el) return;
    const active = jobs.filter((j) => j.status === 'running').length;
    $('#jobCount', root).textContent = jobs.length ? (active ? `${active} активн. · ${jobs.length}` : String(jobs.length)) : '';
    el.innerHTML = jobs.length ? `<ul class="v-dl-jobs">${jobs.map((j) => {
      const [ic, label, cls] = STATE[j.status] || ['clock', j.status || '—', 'off'];
      const preset = PRESETS.find((p) => p[0] === j.preset)?.[1] || j.preset;
      const pct = j.percent != null ? Math.round(j.percent) : null;
      const stateText = j.status === 'running' ? (pct != null ? `${label} ${pct}%` : 'Подготовка') : label;
      return `<li class="${cls}">
        <span class="v-dl-state">${icon(j.status === 'running' && pct == null ? 'clock' : ic, 14)}<span>${esc(stateText)}</span></span>
        <div class="v-dl-job">
          <div class="t" title="${esc(j.title || j.url)}">${esc(j.title || j.url)}</div>
          <div class="meta muted small">${esc(preset)} · <span class="mono">${esc(new Date(j.at).toLocaleString())}</span></div>
          ${j.status === 'running' ? `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" ${pct != null ? `aria-valuenow="${pct}"` : ''} aria-label="Прогресс"><div style="width:${pct || 0}%"></div></div>
            <div class="muted small mono">${esc(j.stage || (pct != null ? pct + '%' : 'Подготовка…'))}${j.speed ? ' · ' + fmt(j.speed) + 'Б/с' : ''}${j.eta ? ' · осталось ' + j.eta + ' с' : ''}</div>` : ''}
          ${j.status === 'done' ? `<div class="muted small mono file" title="${esc(j.file || '')}">${esc(j.file || '')}</div>` : ''}
          ${j.status === 'error' ? `<div class="bad small">${esc(j.error)}</div>` : ''}
        </div>
        <div class="v-dl-act">
          ${j.status === 'running' ? `<button type="button" class="btn ghost sm" data-cancel="${esc(j.id)}">${icon('x', 14)} Отмена</button>` : ''}
          ${j.status === 'done' ? `<button type="button" class="btn ghost sm" data-open="${esc(j.file || '')}">${icon('folder', 14)} Показать файл</button>` : ''}
        </div></li>`;
    }).join('')}</ul>` : '<div class="empty">Пока нет загрузок. Вставьте ссылку выше — задача появится здесь.</div>';
    el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => bg('dlCancel', { job: b.dataset.cancel })));
    el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => bg('dlOpen', { path: b.dataset.open }).catch((e) => toast(e.message, true))));
  };
  const onChange = (ch) => { if (ch.downloads) drawJobs(); };
  chrome.storage.onChanged.addListener(onChange);
  // уходим с экрана — снимаем слушатель сразу, не дожидаясь следующего изменения загрузок
  window.addEventListener('hashchange', () => chrome.storage.onChanged.removeListener(onChange), { once: true });
  drawJobs();
  checkHelper($('#helper', root));
}

async function checkHelper(el) {
  try {
    const s = await bg('dlStatus');
    const item = (k, v, ok = true) => `<span class="${ok ? '' : 'warn'}"><span class="k">${k}</span> ${v}</span>`;
    el.innerHTML = `<div class="v-dl-status ok">
        <span class="v-dl-dot ok" aria-hidden="true"></span>
        <div class="grow"><b>Помощник подключён</b>
          <div class="v-dl-facts small">
            ${item('режим', s.mode === 'http' ? '127.0.0.1:47321' : 'Native Messaging')}
            ${item('yt-dlp', `<span class="mono">${esc(s.ytdlp || 'не найден')}</span>`, !!s.ytdlp)}
            ${item('ffmpeg', s.ffmpeg ? 'есть' : 'нет — 1080p+ и MP3 недоступны', !!s.ffmpeg)}
            ${s.deno === false ? item('deno', 'нет — часть форматов недоступна', false) : ''}
            ${item('папка', `<span class="mono">${esc(s.dir)}</span>`)}
          </div></div>
        <button type="button" class="btn ghost sm" id="upd">${icon('refresh', 14)} Обновить yt-dlp</button></div>`;
    $('#upd', el).addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { await bg('dlUpdate'); toast('yt-dlp обновлён'); } catch (err) { toast(err.message, true); }
      b.disabled = false;
    });
  } catch (e) {
    el.innerHTML = `<div class="v-dl-status err">
        <span class="v-dl-dot err" aria-hidden="true"></span>
        <div class="grow"><b>Помощник загрузки не найден</b><div class="small muted v-dl-err">${esc(e.message)}</div></div>
        <button type="button" class="btn ghost sm" id="retry">${icon('refresh', 14)} Проверить снова</button></div>
      <div class="card v-dl-install">
        <h3>Установка — один раз</h3>
        <p class="muted small">Браузерное расширение не может само запускать программы, поэтому скачивание идёт через маленький локальный помощник на Python с <a target="_blank" href="https://github.com/yt-dlp/yt-dlp">yt-dlp</a>.</p>
        <ol>
          <li>Установите <a target="_blank" href="https://www.python.org/downloads/">Python 3</a> (и по желанию <a target="_blank" href="https://ffmpeg.org/download.html">ffmpeg</a> для 1080p+/MP3).</li>
          <li>Откройте папку расширения, затем <code>native-host</code>.</li>
          <li><b>Windows:</b> дважды кликните <code>УСТАНОВИТЬ.bat</code> — он сам поставит Python, ffmpeg и deno.<br>
              <b>macOS / Linux:</b> <code>bash install.sh</code></li>
          <li>Полностью закройте и снова откройте Chrome.</li>
        </ol>
        <div class="muted small">ID этого расширения: <code>${esc(EXT_ID)}</code>${EXT_ID !== 'mnaoadllhdlnmdccgppbbicpplfihceh' ? ' — он отличается от стандартного, передайте его установщику: <code>install_windows.ps1 -ExtensionId ' + esc(EXT_ID) + '</code>' : ''}</div>
      </div>`;
    $('#retry', el).addEventListener('click', () => {
      el.innerHTML = '<div class="v-dl-status"><span class="v-dl-dot wait" aria-hidden="true"></span><b>Проверяю помощник загрузки…</b></div>';
      checkHelper(el);
    });
  }
}
