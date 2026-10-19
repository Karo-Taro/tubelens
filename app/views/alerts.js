import { pageHead } from '../ui.js';

// Уведомления — в разработке
export async function render(root) {
  root.innerHTML = `<div class="v-alerts">${pageHead('Уведомления', 'Раздел скоро появится.')}</div>`;
}
