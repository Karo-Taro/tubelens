// Применяет сохранённую тему до отрисовки страницы (без «мигания» другой темы).
try {
  const vars = JSON.parse(localStorage.getItem('tl-theme-vars') || 'null');
  if (vars) for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
} catch { /* нет сохранённой темы */ }
