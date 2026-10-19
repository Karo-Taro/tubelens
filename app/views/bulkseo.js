import { pageHead } from '../ui.js';

// SEO моего канала — в разработке
export async function render(root) {
  root.innerHTML = `<div class="v-bulkseo">${pageHead('SEO моего канала', 'Раздел скоро появится.')}</div>`;
}
