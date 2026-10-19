// Тема TubeLens на youtube.com: панели, фильтры, плашка статистики и бейджи
// окрашиваются в тему, выбранную в настройках (Графит, Бордо, Полночь…).
// Цвета берутся из app/themes.js через background — один источник для приложения и YouTube.
(() => {
  const STYLE_ID = 'tl-theme-vars';
  let themes = null; // { id, dark, c } выбранной темы или пара для режима «auto»

  const mix = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

  // Переменные трёх наборов стилей (youtube.css, filters.css, masthead.css) из токенов темы
  function css(t) {
    const c = t.c;
    const soft = mix(c.accent, t.dark ? 16 : 12);
    const vars = {
      '.tl-panel': {
        '--tl-bg': c.panel, '--tl-bg2': c.panel2, '--tl-line': c.line, '--tl-line2': c.line2, '--tl-text': c.text, '--tl-muted': c.muted,
        '--tl-accent': c.accent, '--tl-accent-ink': c.accentInk, '--tl-accent-soft': soft,
      },
      '#tl-filters': {
        '--tlf-bg': c.bg, '--tlf-bg2': c.panel, '--tlf-bg3': c.panel2, '--tlf-line': c.line, '--tlf-text': c.text, '--tlf-muted': c.muted,
        '--tlf-accent': c.accent, '--tlf-accent-ink': c.accentInk, '--tlf-accent-soft': soft,
        '--tlf-up': c.good, '--tlf-up-bg': mix(c.good, 16), '--tlf-hot': c.accent, '--tlf-hot-bg': soft, '--tlf-err': c.bad,
      },
      '#tl-stats-pill': {
        '--tl-sp-bg': c.panel2, '--tl-sp-bg-h': c.line2, '--tl-sp-text': c.text, '--tl-sp-muted': c.muted,
        '--tl-sp-accent': c.accent, '--tl-sp-up': c.good, '--tl-sp-down': c.bad,
      },
      '#tl-stats-menu': {
        '--tl-sm-bg': c.panel, '--tl-sm-bg2': c.panel2, '--tl-sm-line': c.line, '--tl-sm-text': c.text, '--tl-sm-muted': c.muted,
        '--tl-sm-accent': c.accent, '--tl-sm-accent-ink': c.accentInk, '--tl-sm-up': c.good,
      },
    };
    // !important перекрывает значения по умолчанию из html[dark] … в файлах стилей
    let out = Object.entries(vars).map(([sel, v]) =>
      `html ${sel}, html[dark] ${sel} { ${Object.entries(v).map(([k, val]) => `${k}: ${val} !important;`).join(' ')} }`).join('\n');
    // кнопка «Фильтры» и бейджи на карточках — без собственных переменных
    out += `
html #tl-filters-btn, html[dark] #tl-filters-btn { background: ${c.panel2} !important; color: ${c.text} !important; border-color: ${c.line2} !important; }
html #tl-filters-btn svg, html[dark] #tl-filters-btn svg { color: ${c.accent} !important; }
html #tl-filters-btn:hover, html[dark] #tl-filters-btn:hover { border-color: ${c.accent} !important; }
html .tl-pill, html[dark] .tl-pill { background: ${c.panel2} !important; color: ${c.text} !important; }
html .tl-pill.up, html[dark] .tl-pill.up { background: ${mix(c.good, 18)} !important; color: ${c.good} !important; }
html .tl-pill.hot, html[dark] .tl-pill.hot { background: ${soft} !important; color: ${c.accent} !important; }`;
    return out;
  }

  function apply() {
    if (!themes) return;
    const ytDark = document.documentElement.hasAttribute('dark');
    const t = themes.auto ? (ytDark ? themes.dark : themes.light) : themes.theme;
    if (!t) return;
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).append(el);
    }
    el.textContent = css(t);
  }

  function load() {
    try {
      chrome.runtime.sendMessage({ type: 'theme' }, (r) => {
        if (chrome.runtime.lastError || !r?.data) return;
        themes = r.data;
        apply();
      });
    } catch { /* расширение перезагружено — тема останется прежней до обновления страницы */ }
  }

  load();
  // смена темы в настройках — сразу перекрашиваем открытую вкладку
  try {
    chrome.storage.onChanged.addListener((ch) => {
      if (ch.settings && ch.settings.newValue?.theme !== ch.settings.oldValue?.theme) load();
    });
  } catch { /* нет доступа к storage */ }
  // режим «Как в системе» следует светлой/тёмной теме самого YouTube
  new MutationObserver(() => themes?.auto && apply()).observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
})();
