import { $, esc, go, icon, pageHead, timeAgo, loadingHtml, errorHtml, aiOutput, formFields, readForm, toast } from '../ui.js';
import { TOOLS, SYSTEM, toolById } from '../../lib/prompts.js';
import { ask } from '../../lib/ai.js';
import { getData, setData, getSettings } from '../../lib/storage.js';
import { presetById } from '../../lib/presets.js';

// Группы инструментов по задаче автора. Инструменты, которых нет в списке, попадают в «Другое».
const GROUPS = [
  ['Упаковка', ['titles', 'description', 'tags', 'thumbnail']],
  ['Контент', ['ideas', 'script', 'hooks', 'shorts']],
  ['Работа с каналом', ['optimize', 'comments', 'channelAudit']],
];

function groupedTools() {
  const used = new Set(GROUPS.flatMap(([, ids]) => ids));
  const groups = GROUPS.map(([name, ids]) => [name, ids.map(toolById).filter(Boolean)]);
  const rest = TOOLS.filter((t) => !used.has(t.id));
  if (rest.length) groups.push(['Другое', rest]);
  return groups.filter(([, list]) => list.length);
}

export async function render(root, params) {
  const tool = toolById(params.tool) || TOOLS[0];
  const s = await getSettings();
  const preset = presetById(s.ai.preset);
  const model = `<a class="v-ai-model" href="#/settings" title="Изменить в настройках">${icon('sparkles', 14)}<span>${esc(preset.id === 'custom' ? 'Свой эндпоинт' : preset.name.replace(/\s*\(.*\)$/, ''))}</span><span class="mono">${esc(s.ai.model || '—')}</span></a>`;
  const group = groupedTools().find(([, list]) => list.includes(tool))?.[0] || '';

  root.innerHTML = `<div class="v-ai">${pageHead('AI-студия', 'Упаковка, сценарии и работа с аудиторией. Заполните поля — модель предложит варианты, которые можно сразу копировать.', model)}
    <div class="v-ai-grid">
      <nav class="v-ai-tools" aria-label="Инструменты">${groupedTools().map(([name, list]) => `<div class="v-ai-group" role="group" aria-label="${esc(name)}">
        <div class="eyebrow">${esc(name)}</div>
        ${list.map((t) => `<button type="button" class="${t.id === tool.id ? 'on' : ''}" data-id="${t.id}" title="${esc(t.desc)}" ${t.id === tool.id ? 'aria-current="page"' : ''}>
          ${icon(t.icon, 16)}<span>${esc(t.name)}</span></button>`).join('')}</div>`).join('')}</nav>
      <div class="v-ai-main">
        <section class="card v-ai-work">
          <header class="v-ai-toolhead"><span class="tile">${icon(tool.icon, 18)}</span>
            <div><div class="eyebrow">${esc(group)}</div><h2>${esc(tool.name)}</h2><p class="muted small">${esc(tool.desc)}</p></div></header>
          <form id="f">${formFields(tool.fields, params)}
            <div class="v-ai-actions"><button class="btn">${icon('sparkles', 15)} Сгенерировать</button>
              <button type="button" class="btn ghost" id="again" hidden>${icon('refresh', 15)} Другие варианты</button>
              <span class="v-ai-kbd muted small"><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span></div></form>
          <div id="out" class="v-ai-out" aria-live="polite"></div>
        </section>
        <div id="hist"></div>
      </div>
    </div></div>`;
  root.querySelectorAll('.v-ai-tools [data-id]').forEach((el) => el.addEventListener('click', () => go('ai', { tool: el.dataset.id })));

  const out = $('#out', root);
  const run = async (temperature) => {
    const values = readForm($('#f', root));
    const missing = tool.fields.filter((f) => f.req && !values[f.k]);
    if (missing.length) {
      root.querySelector('#f_' + missing[0].k)?.focus();
      return toast('Заполните: ' + missing.map((f) => f.label).join(', '), true);
    }
    out.innerHTML = loadingHtml('AI генерирует…');
    try {
      const text = await ask(tool.prompt(values), SYSTEM, temperature ? { temperature } : {});
      aiOutput(out, text);
      $('#again', root).hidden = false;
      const hist = await getData('aiHistory', []);
      hist.unshift({ tool: tool.id, input: values, text, at: Date.now() });
      await setData('aiHistory', hist.slice(0, 50));
      renderHistory(root);
    } catch (e) { out.innerHTML = errorHtml(e); }
  };
  $('#f', root).addEventListener('submit', (e) => { e.preventDefault(); run(); });
  $('#f', root).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#f', root).requestSubmit(); }
  });
  $('#again', root).addEventListener('click', () => run(1.0));
  renderHistory(root);
}

async function renderHistory(root) {
  const hist = await getData('aiHistory', []);
  const el = $('#hist', root);
  if (!el) return;
  if (!hist.length) return (el.innerHTML = '');
  const shown = hist.slice(0, 15);
  el.innerHTML = `<div class="section-head"><h2>История</h2><span class="muted small mono">${hist.length}</span></div>
    <div class="v-ai-hist">${shown.map((h, i) => {
      const t = toolById(h.tool);
      const snippet = Object.values(h.input || {}).find(Boolean) || '';
      return `<details><summary><span class="ic-wrap">${icon(t?.icon || 'sparkles', 14)}</span>
        <span class="tn">${esc(t?.name || h.tool)}</span><span class="sn">${esc(snippet.slice(0, 120))}</span>
        <time class="mono" datetime="${new Date(h.at).toISOString()}" title="${esc(new Date(h.at).toLocaleString())}">${esc(timeAgo(h.at))}</time></summary>
        <div class="body" data-h="${i}"></div></details>`;
    }).join('')}</div>`;
  el.querySelectorAll('[data-h]').forEach((d) => aiOutput(d, shown[+d.dataset.h].text));
}
