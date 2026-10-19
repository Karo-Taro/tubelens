// Цветовые темы. Каждая тема — набор семантических токенов; CSS берёт только их.
// Добавить свою тему: допишите объект в THEMES — она сразу появится в переключателе.
export const THEMES = [
  {
    id: 'graphite', name: 'Графит', dark: true,
    c: { bg: '#0f121a', panel: '#151a24', panel2: '#1c2230', line: '#262e3f', line2: '#323c52', text: '#e4e7ee', muted: '#8a93a7',
      accent: '#f2a93b', accentInk: '#1b1306', good: '#3ccf91', mid: '#e9b949', bad: '#f06571' },
  },
  {
    id: 'midnight', name: 'Полночь', dark: true,
    c: { bg: '#0b1020', panel: '#111831', panel2: '#18213f', line: '#222d52', line2: '#2f3c69', text: '#e6ebf7', muted: '#8d99b8',
      accent: '#5b8cff', accentInk: '#0b1020', good: '#35d0a0', mid: '#f0b54a', bad: '#ff6b7a' },
  },
  {
    id: 'pine', name: 'Хвоя', dark: true,
    c: { bg: '#0e1513', panel: '#131d1a', panel2: '#1a2723', line: '#24342f', line2: '#30453e', text: '#e2ece8', muted: '#8aa39a',
      accent: '#8fd3b5', accentInk: '#0b1a14', good: '#8fd3b5', mid: '#e3c06b', bad: '#ef7d72' },
  },
  {
    id: 'bordeaux', name: 'Бордо', dark: true,
    c: { bg: '#161012', panel: '#1e1518', panel2: '#281c20', line: '#35262b', line2: '#46323a', text: '#f1e6e8', muted: '#a8939a',
      accent: '#ff8a7a', accentInk: '#2a0d09', good: '#5fd3a0', mid: '#f2c063', bad: '#ff5c6c' },
  },
  {
    id: 'contrast', name: 'Высокий контраст', dark: true,
    c: { bg: '#000000', panel: '#0a0a0a', panel2: '#161616', line: '#3a3a3a', line2: '#5a5a5a', text: '#ffffff', muted: '#c8c8c8',
      accent: '#ffd60a', accentInk: '#000000', good: '#4cff9a', mid: '#ffd60a', bad: '#ff6b6b' },
  },
  {
    id: 'paper', name: 'Бумага', dark: false,
    c: { bg: '#f6f7f9', panel: '#ffffff', panel2: '#eef1f5', line: '#e0e4ea', line2: '#cdd3dd', text: '#151a24', muted: '#5e6778',
      accent: '#1e40af', accentInk: '#ffffff', good: '#0d7752', mid: '#976200', bad: '#c62f3f' },
  },
  {
    id: 'sand', name: 'Студия', dark: false,
    c: { bg: '#f3f4f6', panel: '#ffffff', panel2: '#eceef2', line: '#dfe2e8', line2: '#c9ced8', text: '#1a1d24', muted: '#5f6675',
      accent: '#a24e00', accentInk: '#ffffff', good: '#117750', mid: '#906300', bad: '#c13343' },
  },
];

export const AUTO = { id: 'auto', name: 'Как в системе' };

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function resolveTheme(id) {
  if (id === 'auto' || !id) {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    return THEMES.find((t) => t.id === (dark ? 'graphite' : 'paper'));
  }
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

export function applyTheme(id) {
  const t = resolveTheme(id);
  const r = document.documentElement.style;
  const c = t.c;
  const map = {
    bg: c.bg, panel: c.panel, panel2: c.panel2, line: c.line, line2: c.line2, text: c.text, muted: c.muted,
    accent: c.accent, 'accent-ink': c.accentInk, 'accent-soft': hexA(c.accent, t.dark ? 0.14 : 0.1),
    good: c.good, mid: c.mid, bad: c.bad, 'good-soft': hexA(c.good, 0.14), 'bad-soft': hexA(c.bad, 0.12),
  };
  const vars = { 'color-scheme': t.dark ? 'dark' : 'light' };
  for (const [k, v] of Object.entries(map)) vars['--' + k] = v;
  for (const [k, v] of Object.entries(vars)) r.setProperty(k, v);
  document.documentElement.dataset.theme = t.id;
  try { localStorage.setItem('tl-theme-vars', JSON.stringify(vars)); } catch { /* приватный режим */ }
}

// Мини-превью темы для переключателя
export const swatch = (t) =>
  `<span class="swatch" style="background:${t.c.bg};border-color:${t.c.line2}"><i style="background:${t.c.panel2}"></i><i style="background:${t.c.accent}"></i></span>`;
