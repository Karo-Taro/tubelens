import { pageHead } from '../ui.js';

// A/B-превью — в разработке
export async function render(root) {
  root.innerHTML = `<div class="v-abtest">${pageHead('A/B-превью', 'Раздел скоро появится.')}</div>`;
}
