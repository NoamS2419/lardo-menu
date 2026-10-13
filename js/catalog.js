/* Catalog: data loading, categories, product pages, search, info pages. */

import {
  DATA_URL, db, announce, esc, norm, shekel, priceLabel, initial, imgSrc, imgHtml, tagsHtml, productCard, setPage
} from './core.js';
import { progress, setKnown, knownCount, progressBar } from './progress.js';

/* ---------- data ---------- */

export async function loadData() {
  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  const products = (raw.products || []).filter((p) => p && p.id && p.name);
  const byCat = new Map();
  for (const p of products) {
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category).push(p);
  }
  // Only categories that actually have products are shown.
  const categories = (raw.categories || []).filter((c) => byCat.has(c.id));
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const p of products) {
    p._search = norm([
      p.name, p.description, p.staff_description,
      ...(p.aliases || []), ...(p.ingredients || []), ...(p.choices || []), ...(p.tags || [])
    ].join(' '));
  }
  return { categories, products, byId, byCat, faq: raw.customer_faq || [], updated: raw.updated };
}

/* ---------- views ---------- */

export function viewHome() {
  const cards = db.categories.map((c) => {
    const items = db.byCat.get(c.id);
    const cover = items.find((p) => p.image) || items[0];
    return `
      <li>
        <a class="card" href="#/c/${encodeURIComponent(c.id)}">
          ${cover.image
            ? `<img class="thumb" src="${esc(imgSrc(cover.image))}" alt="" data-pid="${esc(cover.id)}" loading="lazy" decoding="async">`
            : `<div class="thumb ph" aria-hidden="true">${initial(c.name)}</div>`}
          <span class="card-body">
            <span class="card-title">${esc(c.name)}</span>
            <span class="card-sub">מכיר/ה ${knownCount(items)} מתוך ${items.length}</span>
            ${progressBar(knownCount(items), items.length, c.name)}
          </span>
        </a>
      </li>`;
  }).join('');
  setPage('', `
    <div class="actions">
      <a class="action" href="#/learn"><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="13" height="16" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/></svg>כרטיסיות</a>
      <a class="action" href="#/games"><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>משחקים</a>
    </div>
    <p class="summary">מכיר/ה ${knownCount(db.products)} מתוך ${db.products.length} מוצרים</p>
    <h1>מה יש אצלנו</h1>
    <ul class="grid">${cards}</ul>
  `);
}

export function viewCategory(id) {
  const cat = db.categories.find((c) => c.id === id);
  if (!cat) return viewNotFound();
  const items = db.byCat.get(id);
  setPage(cat.name, `
    <a class="back" href="#/"><span aria-hidden="true">→</span> כל הקטגוריות</a>
    <h1>${esc(cat.name)}</h1>
    <ul class="grid">${items.map(productCard).join('')}</ul>
  `);
}

export function viewProduct(id) {
  const p = db.byId.get(id);
  if (!p) return viewNotFound();
  const cat = db.categories.find((c) => c.id === p.category);
  const sizes = (p.sizes && p.sizes.length)
    ? `<h2>גדלים ומחירים</h2>
       <ul class="sizes">${p.sizes.map((s) =>
         `<li>${esc(s.label)}: <strong><bdi>${esc(shekel(s.price) ?? '?')}</bdi></strong></li>`).join('')}</ul>`
    : `<p class="big-price"><bdi>${esc(priceLabel(p))}</bdi></p>`;
  // Skip the chips when they only repeat the description word for word.
  const sameAsDesc = norm((p.ingredients || []).join(' ')) === norm((p.description || '').replace(/,/g, ' '));
  const ingredients = (p.ingredients && p.ingredients.length && !sameAsDesc)
    ? `<h2>מרכיבים עיקריים</h2>
       <ul class="ingredients">${p.ingredients.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    : '';
  const list = (title, arr) => (arr && arr.length)
    ? `<h2>${title}</h2><ul class="ingredients">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '';
  const notes = (p.notes && p.notes.length)
    ? `<ul class="notes">${p.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';
  const notWolt = p.is_wolt === false
    ? '<p class="note">נמכר בדלפק בלבד, לא מופיע בוולט.</p>'
    : '';
  const known = !!progress.known[p.id];
  setPage(p.name, `
    ${cat ? `<a class="back" href="#/c/${encodeURIComponent(cat.id)}"><span aria-hidden="true">→</span> ${esc(cat.name)}</a>` : ''}
    <article class="product">
      ${imgHtml(p, 'product-hero', 800)}
      <div>
        <h1>${esc(p.name)}${p.unit ? ` <span class="unit">(${esc(p.unit)})</span>` : ''}</h1>
        ${(p.aliases && p.aliases.length) ? `<p class="aka">נקרא גם: ${p.aliases.map(esc).join(', ')}</p>` : ''}
        ${sizes}
        ${tagsHtml(p.tags)}
        ${p.description ? `<h2>תיאור</h2><p>${esc(p.description)}</p>` : ''}
        ${p.staff_description && p.staff_description !== p.description
          ? `<h2>בשפה של הצוות</h2><p>${esc(p.staff_description)}</p>` : ''}
        ${list('טעמים', p.choices)}
        ${ingredients}
        ${notes}
        ${notWolt}
        <button class="btn know${known ? ' on' : ''}" id="know" type="button" aria-pressed="${known}">
          ${known ? '✓ אני מכיר/ה' : 'סמן/י שאני מכיר/ה'}
        </button>
      </div>
    </article>
  `);
  document.getElementById('know').addEventListener('click', () => {
    setKnown(p.id, !progress.known[p.id]);
    const b = document.getElementById('know');
    const on = !!progress.known[p.id];
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? '✓ אני מכיר/ה' : 'סמן/י שאני מכיר/ה';
  });
}

export function viewSearch(q = '') {
  setPage('חיפוש', `
    <h1>חיפוש</h1>
    <form class="search-box" role="search" id="search-form">
      <label for="q" class="sr-only">חיפוש לפי שם או מרכיב</label>
      <input id="q" type="search" placeholder="שם או מרכיב, למשל פיסטוק" autocomplete="off" enterkeyhint="search" value="${esc(q)}">
    </form>
    <div id="results"></div>
  `);
  const input = document.getElementById('q');
  const results = document.getElementById('results');
  const run = () => {
    const terms = norm(input.value).split(' ').filter(Boolean);
    history.replaceState(null, '', `#/search${input.value ? `?q=${encodeURIComponent(input.value)}` : ''}`);
    if (!terms.length) { results.innerHTML = ''; return; }
    const found = db.products.filter((p) => terms.every((t) => p._search.includes(t)));
    results.innerHTML = found.length
      ? `<ul class="grid">${found.map(productCard).join('')}</ul>`
      : '<p class="empty">לא נמצאו מוצרים</p>';
    announce(found.length ? `נמצאו ${found.length} מוצרים` : 'לא נמצאו מוצרים');
  };
  document.getElementById('search-form').addEventListener('submit', (e) => { e.preventDefault(); input.blur(); });
  input.addEventListener('input', run);
  run();
  input.focus();
}

export function viewFaq() {
  setPage('שאלות של לקוחות', `
    <a class="back" href="#/"><span aria-hidden="true">→</span> דף הבית</a>
    <article class="prose">
      <h1>שאלות של לקוחות</h1>
      <p class="note">כשלקוח שואל על הריון, כשרות או רגישות ואתם לא בטוחים, תפנו אותו לאחראי המשמרת. אל תבטיחו "בטוח" או "כשר" על דעת עצמכם.</p>

      ${db.faq.map((f) => `<h2>${esc(f.topic)}</h2><p>${esc(f.text)}</p>`).join('')}
    </article>
  `);
}

export function viewAccessibility() {
  setPage('הצהרת נגישות', `
    <a class="back" href="#/"><span aria-hidden="true">→</span> דף הבית</a>
    <article class="prose">
      <h1>הצהרת נגישות</h1>
      <p>לארדו תפריט הוא אתר פנימי ללימוד המוצרים, לעובדי הסניף בלבד. השתדלנו לבנות אותו לפי הנחיות WCAG 2.0 ברמה AA, אבל הוא לא עבר בדיקה של מורשה נגישות.</p>
      <h2>מה עשינו</h2>
      <ul>
        <li>האתר בעברית ומימין לשמאל, ונבנה כך שיעבוד עם קוראי מסך.</li>
        <li>הטקסט מתגדל לפי הגדרות הגופן בטלפון, והכפתורים גדולים ונוחים ללחיצה.</li>
        <li>ניגודיות צבעים מספקת, גם במצב כהה.</li>
        <li>לכל תמונה יש תיאור, ואפשר לנווט בכל האתר גם במקלדת.</li>
        <li>מידע לא מועבר בצבע בלבד, ואין אנימציות למי שביקש להפחית תנועה.</li>
      </ul>
      <h2>מגבלות ידועות</h2>
      <ul>
        <li>תמונות המוצרים מגיעות מוולט. אם תמונה לא נטענת, מוצג במקומה ריבוע עם האות הראשונה.</li>
        <li>במשחק "מה זה?" מי שלא רואה את התמונה מקבל רמז מילולי מהתיאור, שהוא פחות מדויק מהתמונה.</li>
        <li>חלק מהמוצרים עוד בלי תמונה ובלי תיאור מלא.</li>
      </ul>
      <p>נבדק באוקטובר 2026 בכלי axe ובבדיקה ידנית עם מקלדת וקורא מסך.</p>
            <h2>נתקלתם בבעיה?</h2>
      <p>אם משהו באתר לא נגיש לכם, ספרו לנועם שער או לאחראי המשמרת, ונתקן.</p>
      <p>עודכן לאחרונה: אוקטובר 2026.</p>
    </article>
  `);
}

export function viewNotFound() {
  setPage('לא נמצא', `
    <h1>הדף לא נמצא</h1>
    <p><a href="#/">חזרה לדף הבית</a></p>
  `);
}
