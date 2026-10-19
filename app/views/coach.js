import { $, esc, md, icon, pageHead, loadingHtml, errorHtml } from '../ui.js';
import { chat } from '../../lib/ai.js';
import { SYSTEM } from '../../lib/prompts.js';
import { getData, setData, getSettings } from '../../lib/storage.js';
import { channelAudit, channelContext } from '../../lib/analysis.js';

const STARTERS = [
  'Почему у последних видео упал CTR?',
  'Как удержать зрителя в первые 30 секунд?',
  'Составь контент-план на месяц',
  'Как часто выпускать Shorts?',
];

export async function render(root) {
  const s = await getSettings();
  let history = await getData('coachChat', []);
  root.innerHTML = `<div class="v-coach">${pageHead('AI-коуч', 'Разбор канала, темы, обложки, удержание. Коуч помнит разговор, пока вы его не очистите.',
    `<button type="button" class="btn ghost sm" id="clear">${icon('trash', 14)} Очистить</button>`)}
    <div class="v-coach-log" role="log" aria-live="polite"><div class="chat" id="chat"></div><div id="wait"></div></div>
    <form id="f" class="v-coach-composer">
      <label for="m" class="v-sr">Сообщение коучу</label>
      <textarea id="m" rows="3" placeholder="Спросите что угодно о росте канала: темы, обложки, удержание, монетизация…"></textarea>
      <div class="v-coach-bar">
        ${s.myChannel
          ? '<label class="check"><input type="checkbox" id="ctx" checked> Учитывать статистику моего канала</label>'
          : `<span class="muted small"><a href="#/settings">Укажите свой канал</a>, чтобы коуч видел статистику</span>`}
        <span class="spacer"></span>
        <span class="v-coach-kbd muted small"><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span>
        <button class="btn">${icon('send', 15)} Отправить</button>
      </div>
    </form></div>`;
  const chatEl = $('#chat', root);
  const draw = () => {
    chatEl.innerHTML = history.length
      ? history.map((m) => `<div class="v-coach-turn ${m.role}"><div class="who">${m.role === 'user' ? 'Вы' : 'Коуч'}</div><div class="msg ${m.role}">${md(m.content).replace(/<\/h4>\n+/g, '</h4>')}</div></div>`).join('')
      : `<div class="v-coach-empty"><p>Привет! Я ваш YouTube-коуч. Расскажите о канале или начните с вопроса:</p>
          <div class="chips">${STARTERS.map((q) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`;
    chatEl.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
      const m = $('#m', root);
      m.value = b.dataset.q;
      m.focus();
    }));
    const last = chatEl.lastElementChild;
    if (history.length && last) last.scrollIntoView({ block: 'nearest' });
  };
  draw();

  let ctxCache = null;
  $('#m', root).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#f', root).requestSubmit();
  });
  $('#clear', root).addEventListener('click', async () => { history = []; await setData('coachChat', history); draw(); });
  $('#f', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#m', root).value.trim();
    if (!text) return;
    $('#m', root).value = '';
    history.push({ role: 'user', content: text });
    draw();
    const wait = $('#wait', root);
    wait.innerHTML = loadingHtml('Коуч печатает…');
    try {
      let system = SYSTEM + ' Ты — персональный коуч автора канала. Задавай уточняющие вопросы, если не хватает данных.';
      if ($('#ctx', root)?.checked) {
        ctxCache ??= channelContext(await channelAudit(s.myChannel, 30));
        system += '\n\nДанные канала пользователя:\n' + ctxCache;
      }
      const answer = await chat({ messages: history.slice(-20), system });
      history.push({ role: 'assistant', content: answer });
      await setData('coachChat', history.slice(-100));
      wait.innerHTML = '';
      draw();
    } catch (err) {
      history.pop();
      wait.innerHTML = errorHtml(err);
      $('#m', root).value = text;
      draw();
    }
  });
}
