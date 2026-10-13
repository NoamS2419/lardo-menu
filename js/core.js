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

// Simple line icons per category, used on placeholders and category banners.
const CAT_ICONS = {
  pastries: '<path d="M3 15c2-6 6-9 9-9s7 3 9 9c-2 1.5-5 2.5-9 2.5S5 16.5 3 15z"/><path d="M8.5 8.5l1.5 8.5M15.5 8.5l-1.5 8.5M12 6.2v11"/>',
  patisserie: '<path d="M5 11h14l-1.8 9H6.8z"/><path d="M5 11a7 7 0 0 1 14 0"/><circle cx="12" cy="3.6" r="1.4"/>',
  cakes: '<path d="M4 20h16v-8H4z"/><path d="M4 15.5c2 1.5 4 1.5 6 0s4-1.5 6 0 3 1 4 0"/><path d="M8 12V8.5M12 12V8M16 12V8.5"/><path d="M8 6.5v-.5M12 6v-.5M16 6.5v-.5"/>',
  tarts: '<ellipse cx="12" cy="12" rx="9" ry="3.6"/><path d="M3 12v2.5c0 2 4 3.8 9 3.8s9-1.8 9-3.8V12"/><circle cx="9" cy="11.5" r="1"/><circle cx="14.5" cy="11" r="1"/><circle cx="12" cy="13.2" r="1"/>',
  pizzas: '<path d="M12 3 3 19.5c5.6 2 12.4 2 18 0z"/><circle cx="10" cy="13" r="1.3"/><circle cx="14" cy="16" r="1.3"/><circle cx="12.5" cy="9.5" r="1"/>',
  sandwiches: '<path d="M3 10c0-3 4-5 9-5s9 2 9 5z"/><path d="M3 13.5h18"/><path d="M4 17h16l-1 2.5H5z"/>',
  cookies: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r=".9"/><circle cx="15" cy="9.5" r=".9"/><circle cx="9.5" cy="15" r=".9"/><circle cx="15" cy="15" r=".9"/><circle cx="12" cy="12" r=".9"/>',
  breads: '<path d="M5 20v-9a4 4 0 0 1 1.5-7.5h11A4 4 0 0 1 19 11v9z"/><path d="M9 9.5l2 2M13 9.5l2 2"/>',
  salads: '<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 11c0-3 1.8-5 4-6M12.5 11c0-2.2 2-4.2 5-4.4M6.5 7c1.2 1 2 2.3 2.2 4"/>',
  boxes: '<rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M3 13h18M12 9v11"/><path d="M12 9c-1.5-3.5-6-4-6-1.5S12 9 12 9s6 1 6-1.5-4.5-2-6 1.5"/>',
  drinks: '<path d="M7 4h10l-1.6 16.5H8.6z"/><path d="M7.6 10h8.8"/><path d="M13.5 4l2.5-2.5"/>'
};

export const catIcon = (catId, cls = 'cat-icon') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${CAT_ICONS[catId] || '<circle cx="12" cy="12" r="8"/>'}</svg>`;

// A product without a photo gets its category's icon on its category's color.
export const placeholder = (catId, cls) =>
  `<div class="${cls} ph tint-${esc(catId)}" aria-hidden="true">${catIcon(catId)}</div>`;

// alt is '' where the name is already printed next to the image.
export const imgHtml = (p, cls, w, alt = p.name) => p.image
  ? `<img class="${cls}" src="${esc(imgSrc(p.image, w))}" alt="${esc(alt)}" data-pid="${esc(p.id)}" loading="lazy" decoding="async">`
  : placeholder(p.category, cls);

// Pregnancy tags stand out; the "maybe" one is softer.
const tagClass = (t) => !/הריון/.test(t) ? '' : /אולי/.test(t) ? ' maybe' : ' warn';

export const tagsHtml = (tags) => (tags && tags.length)
  ? `<ul class="tags" aria-label="תגיות">${tags.map((t) =>
      `<li class="tag${tagClass(t)}">${esc(t)}</li>`).join('')}</ul>`
  : '';

// Sweet / savory / drink, so game distractors come from the same family.
const SAVORY_CATS = ['sandwiches', 'pizzas', 'salads', 'breads'];
const SAVORY_WORDS = ['גבינ', 'פטה', 'צדר', 'מוצרלה', 'גודה', 'פרמז', 'לבנה', 'מנגולד', 'תרד', 'פיצה', 'כמהין', 'עגבני'].map(norm);
export const family = (p) => {
  if (p.category === 'drinks') return 'drink';
  if (SAVORY_CATS.includes(p.category)) return 'savory';
  if (p.category !== 'pastries') return 'sweet';
  const text = norm([p.name, p.description, p.staff_description].join(' '));
  return SAVORY_WORDS.some((w) => text.includes(w)) ? 'savory' : 'sweet';
};

export const productCard = (p, known = false) => `
  <li class="rise">
    <a class="card${known ? ' is-known' : ''}" href="#/p/${encodeURIComponent(p.id)}">
      <span class="thumb-wrap">${imgHtml(p, 'thumb', 400, '')}${known ? '<span class="known-badge"><span aria-hidden="true">✓</span><span class="sr-only">מכיר/ה</span></span>' : ''}</span>
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
  document.body.classList.remove('in-game');
  // Replay the page entrance and stagger cards in (CSS skips this under reduced motion).
  main.classList.remove('enter');
  void main.offsetWidth;
  main.classList.add('enter');
  main.querySelectorAll('.rise').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 14)));
  requestAnimationFrame(() => requestAnimationFrame(() => fillMeters()));
}

// Meters start empty and grow to their value, so progress feels earned.
export function fillMeters(root = main) {
  root.querySelectorAll('.meter-fill[data-pct]').forEach((el) => { el.style.width = `${el.dataset.pct}%`; });
  root.querySelectorAll('.ring-fill[data-pct]').forEach((el) => {
    const c = 2 * Math.PI * Number(el.getAttribute('r'));
    el.style.strokeDasharray = `${c}`;
    el.style.strokeDashoffset = `${c * (1 - Number(el.dataset.pct) / 100)}`;
  });
}

export const meter = (done, total, label) => {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<span class="meter" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-valuetext="${done} מתוך ${total}"><span class="meter-fill" data-pct="${pct}"></span></span>`;
};

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// After navigation, move focus to the page heading so screen readers announce the new page.
export function focusMain() {
  const h1 = main.querySelector('h1');
  if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); } else main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
