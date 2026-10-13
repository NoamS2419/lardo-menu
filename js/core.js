/* Shared state, formatting helpers and page plumbing. */

export const DATA_URL = 'data/products.json';
export const main = document.getElementById('main');
export const live = document.getElementById('live');

// Loaded product data: { categories, products, byId, byCat, faq }. Set once at startup.
export let db = null;
export function setDb(value) { db = value; }

/* ---------- helpers ---------- */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Folds spelling variants so "צדר" finds "צ'דר" and "גנדויה" finds "גאנדויה".
export const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[֑-ׇ]/g, '')       // niqqud
  .replace(/['"`׳״’‘\-–|]/g, '')
  .replace(/[ךםןףץ]/g, (c) => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }[c]))
  .replace(/([^\s])א/g, '$1')           // "גאנדויה" ~ "גנדויה" (not at word start)
  .replace(/\s+/g, ' ')
  .trim();

export const shekel = (n) => (typeof n === 'number' ? `${n} ₪` : null);

export const priceLabel = (p) => {
  if (p.sizes && p.sizes.length) {
    const prices = p.sizes.map((s) => s.price).filter((n) => typeof n === 'number');
    if (prices.length) return `מ־${Math.min(...prices)} ₪`;
  }
  return shekel(p.price) ?? 'מחיר בדלפק';
};

export const initial = (name) => esc((name || '?').trim().charAt(0));

// Wolt image URLs take a width; local files live under data/.
export const imgSrc = (image, w = 400) => /^https:\/\//.test(image) ? `${image}?w=${w}` : `data/${image}`;

// alt is '' where the name is already printed next to the image.
export const imgHtml = (p, cls, w, alt = p.name) => p.image
  ? `<img class="${cls}" src="${esc(imgSrc(p.image, w))}" alt="${esc(alt)}" data-pid="${esc(p.id)}" loading="lazy" decoding="async">`
  : `<div class="${cls} ph" aria-hidden="true">${initial(p.name)}</div>`;

// Pregnancy tags stand out; the "maybe" one is softer.
const tagClass = (t) => !/הריון/.test(t) ? '' : /אולי/.test(t) ? ' maybe' : ' warn';

export const tagsHtml = (tags) => (tags && tags.length)
  ? `<ul class="tags" aria-label="תגיות">${tags.map((t) =>
      `<li class="tag${tagClass(t)}">${esc(t)}</li>`).join('')}</ul>`
  : '';

// Sweet / savory / drink, so game distractors come from the same family.
const SAVORY_CATS = ['sandwiches', 'salads', 'breads'];
const SAVORY_WORDS = ['גבינ', 'פטה', 'צדר', 'מוצרלה', 'גודה', 'פרמז', 'לבנה', 'מנגולד', 'תרד', 'פיצה', 'כמהין', 'עגבני'].map(norm);
export const family = (p) => {
  if (p.category === 'drinks') return 'drink';
  if (SAVORY_CATS.includes(p.category)) return 'savory';
  if (p.category !== 'pastries') return 'sweet';
  const text = norm([p.name, p.description, p.staff_description].join(' '));
  return SAVORY_WORDS.some((w) => text.includes(w)) ? 'savory' : 'sweet';
};

export const productCard = (p) => `
  <li>
    <a class="card" href="#/p/${encodeURIComponent(p.id)}">
      ${imgHtml(p, 'thumb', 400, '')}
      <span class="card-body">
        <span class="card-title">${esc(p.name)}</span>
        <span class="card-sub price"><bdi>${esc(priceLabel(p))}</bdi></span>
        ${tagsHtml(p.tags)}
      </span>
    </a>
  </li>`;

// Clear first so the same message read twice is still announced.
export function announce(text) {
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 50);
}

export function setPage(title, html) {
  document.title = title ? `${title} · לארדו תפריט` : 'לארדו תפריט';
  main.innerHTML = html;
}

// After navigation, move focus to the page heading so screen readers announce the new page.
export function focusMain() {
  const h1 = main.querySelector('h1');
  if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); } else main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
