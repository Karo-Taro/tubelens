// Набор линейных SVG-иконок (24×24, обводка currentColor). icon('name', size)
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3"/><path d="m17 6 3 3"/><path d="m14.5 8.5 2 2"/>',
  play: '<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="m10 9 5 3-5 3z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.3-5.5 6.5-5.5s5.7 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.9c1.8.8 3 2.5 3.5 5.1"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  sparkles: '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 11 10.1 9z"/><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  message: '<path d="M4 4.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-15a1 1 0 0 1 1-1z"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
  settings: '<path d="M4 6h9"/><path d="M17 6h3"/><circle cx="15" cy="6" r="2"/><path d="M4 12h3"/><path d="M11 12h9"/><circle cx="9" cy="12" r="2"/><path d="M4 18h11"/><path d="M19 18h1"/><circle cx="17" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  external: '<path d="M14 3h7v7"/><path d="m21 3-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  zap: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.6.5.8 1.2.8 1.9V16h6v-.5c0-.7.3-1.4.8-1.9A6 6 0 0 0 12 3z"/>',
  file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M9 12h6"/><path d="M9 16h6"/>',
  hash: '<path d="M5 9h15"/><path d="M4 15h15"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7.5 4v16"/><path d="M16.5 4v16"/><path d="M3 9.5h4.5"/><path d="M3 14.5h4.5"/><path d="M16.5 9.5H21"/><path d="M16.5 14.5H21"/>',
  hook: '<path d="M12 3v11a4 4 0 1 1-8 0v-1"/><path d="m2 15 2-2 2 2"/><circle cx="12" cy="3.5" r="1"/>',
  gauge: '<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="m12 17 4-6"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  wand: '<path d="m4 20 11-11"/><path d="m13 7 4 4"/><path d="M18 3v3"/><path d="M21 6h-3"/><path d="M8 3v2"/><path d="M9 4H7"/><path d="M20 13v2"/><path d="M21 14h-2"/>',
  send: '<path d="m3 11 18-8-8 18-2-8z"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.8-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.4-9-7.4z"/><circle cx="7.5" cy="11.5" r="1.2"/><circle cx="10" cy="7.5" r="1.2"/><circle cx="14.5" cy="7.5" r="1.2"/>',
  code: '<path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/><path d="m14 4-4 16"/>',
  plane: '<path d="M21.5 3.5 2.5 11l7 2.5 2.5 7z"/><path d="m9.5 13.5 12-10"/>',
  scale: '<path d="M12 3v18"/><path d="M7 21h10"/><path d="M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0z"/><path d="m19 7-3 7a3 3 0 0 0 6 0z"/>',
};

export function icon(name, size = 16, cls = '') {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.sparkles}</svg>`;
}

export const ICONS = P;
