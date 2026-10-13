'use strict';

const DATA_URL = 'data/products.json';
const main = document.getElementById('main');
const live = document.getElementById('live');

let db = null; // { categories, products, byId, byCat }

/* ---------- helpers ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Folds spelling variants so "צדר" finds "צ'דר" and "גנדויה" finds "גאנדויה".
const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[֑-ׇ]/g, '')       // niqqud
  .replace(/['"`׳״’‘\-–|]/g, '')
  .replace(/[ךםןףץ]/g, (c) => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }[c]))
  .replace(/(.)א/g, '$1')                // "גאנדויה" ~ "גנדויה"
  .replace(/\s+/g, ' ')
  .trim();

const shekel = (n) => (typeof n === 'number' ? `${n} ₪` : null);

const priceLabel = (p) => {
  if (p.sizes && p.sizes.length) {
    const prices = p.sizes.map((s) => s.price).filter((n) => typeof n === 'number');
    if (prices.length) return `מ־${Math.min(...prices)} ₪`;
  }
  return shekel(p.price) ?? 'מחיר יעודכן';
};

const initial = (name) => esc((name || '?').trim().charAt(0));

const imgHtml = (p, cls) => p.image
  ? `<img class="${cls}" src="data/${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
  : `<div class="${cls} ph" aria-hidden="true">${initial(p.name)}</div>`;

const isWarnTag = (t) => /הריון/.test(t);

const tagsHtml = (tags) => (tags && tags.length)
  ? `<ul class="tags" aria-label="תגיות">${tags.map((t) =>
      `<li class="tag${isWarnTag(t) ? ' warn' : ''}">${esc(t)}</li>`).join('')}</ul>`
  : '';

const productCard = (p) => `
  <li>
    <a class="card" href="#/p/${encodeURIComponent(p.id)}">
      ${imgHtml(p, 'thumb')}
      <span class="card-body">
        <span class="card-title">${esc(p.name)}</span>
        <span class="card-sub price">${esc(priceLabel(p))}</span>
        ${tagsHtml(p.tags)}
      </span>
    </a>
  </li>`;

function setPage(title, html) {
  document.title = title ? `${title} · לארדו תפריט` : 'לארדו תפריט';
  main.innerHTML = html;
}

function focusMain() {
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/* ---------- data ---------- */

async function loadData() {
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
    p._search = norm([p.name, p.description, ...(p.ingredients || []), ...(p.tags || [])].join(' '));
  }
  return { categories, products, byId, byCat, updated: raw.updated };
}

/* ---------- views ---------- */

function viewHome() {
  const cards = db.categories.map((c) => {
    const items = db.byCat.get(c.id);
    const cover = items.find((p) => p.image) || items[0];
    return `
      <li>
        <a class="card" href="#/c/${encodeURIComponent(c.id)}">
          ${cover.image
            ? `<img class="thumb" src="data/${esc(cover.image)}" alt="" loading="lazy" decoding="async">`
            : `<div class="thumb ph" aria-hidden="true">${initial(c.name)}</div>`}
          <span class="card-body">
            <span class="card-title">${esc(c.name)}</span>
            <span class="card-sub">${items.length} מוצרים</span>
          </span>
        </a>
      </li>`;
  }).join('');
  setPage('', `
    <h1>מה יש אצלנו</h1>
    <ul class="grid">${cards}</ul>
  `);
}

function viewCategory(id) {
  const cat = db.categories.find((c) => c.id === id);
  if (!cat) return viewNotFound();
  const items = db.byCat.get(id);
  setPage(cat.name, `
    <a class="back" href="#/">→ כל הקטגוריות</a>
    <h1>${esc(cat.name)}</h1>
    <ul class="grid">${items.map(productCard).join('')}</ul>
  `);
}

function viewProduct(id) {
  const p = db.byId.get(id);
  if (!p) return viewNotFound();
  const cat = db.categories.find((c) => c.id === p.category);
  const sizes = (p.sizes && p.sizes.length)
    ? `<h2>גדלים ומחירים</h2>
       <ul class="sizes">${p.sizes.map((s) =>
         `<li>${esc(s.label)}: <strong>${esc(shekel(s.price) ?? '?')}</strong></li>`).join('')}</ul>`
    : `<p class="big-price">${esc(priceLabel(p))}</p>`;
  const ingredients = (p.ingredients && p.ingredients.length)
    ? `<h2>מרכיבים עיקריים</h2>
       <ul class="ingredients">${p.ingredients.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    : '';
  const notWolt = p.wolt === false
    ? '<p class="note">נמכר בדלפק בלבד, לא מופיע בוולט.</p>'
    : '';
  setPage(p.name, `
    ${cat ? `<a class="back" href="#/c/${encodeURIComponent(cat.id)}">→ ${esc(cat.name)}</a>` : ''}
    <article class="product">
      ${imgHtml(p, 'product-hero')}
      <div>
        <h1>${esc(p.name)}</h1>
        ${sizes}
        ${tagsHtml(p.tags)}
        ${p.description ? `<h2>תיאור</h2><p>${esc(p.description)}</p>` : ''}
        ${ingredients}
        ${notWolt}
      </div>
    </article>
  `);
}

function viewSearch(q = '') {
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
    if (!terms.length) { results.innerHTML = ''; live.textContent = ''; return; }
    const found = db.products.filter((p) => terms.every((t) => p._search.includes(t)));
    results.innerHTML = found.length
      ? `<ul class="grid">${found.map(productCard).join('')}</ul>`
      : '<p class="empty">לא נמצאו מוצרים</p>';
    live.textContent = found.length ? `נמצאו ${found.length} מוצרים` : 'לא נמצאו מוצרים';
  };
  document.getElementById('search-form').addEventListener('submit', (e) => { e.preventDefault(); input.blur(); });
  input.addEventListener('input', run);
  run();
  input.focus();
}

function viewFaq() {
  setPage('שאלות של לקוחות', `
    <a class="back" href="#/">→ דף הבית</a>
    <article class="prose">
      <h1>שאלות של לקוחות</h1>
      <p class="note">כשלקוח שואל על הריון, כשרות או רגישות ואתם לא בטוחים, תפנו אותו לאחראי המשמרת. אל תבטיחו "בטוח" או "כשר" על דעת עצמכם.</p>

      <h2>שמירה והובלה</h2>
      <ul>
        <li>העוגות והקינוחים מגיעים קפואים. אפשר לשמור אותם כמה ימים במקפיא.</li>
        <li>להוציא מהמקפיא בערך שעה לפני שרוצים לאכול.</li>
        <li>נסיעה של חצי שעה באוטו זה בסדר. שעה זה כבר גבולי.</li>
      </ul>

      <h2>הריון</h2>
      <p>עקרונית כל המוצרים מפוסטרים. ללקוחה שמקפידה במיוחד, אלה המוצרים שכדאי להזהיר לגביהם:</p>
      <ul>
        <li>כריך סלק (גבינה במים)</li>
        <li>פיצה בוראטה (גבינה במים)</li>
        <li>טארט לימון, הקטן והגדול (מרנג, ביצים)</li>
        <li>אולי מאפים עם פטה פסטו (גבינה במים)</li>
      </ul>

      <h2>כשרות</h2>
      <ul>
        <li>מוצרים עם שוקולד גאנדויה הם בחלב נוכרי, למשל מקל קרואסון גאנדויה ופאן סוויס.</li>
        <li>שוקולד דולצ'ה (לבן מקורמל) בכשרות רעננה, בלי חלב נוכרי.</li>
        <li>כל שאר המוצרים בכשרות רעננה.</li>
      </ul>
    </article>
  `);
}

function viewAccessibility() {
  setPage('הצהרת נגישות', `
    <a class="back" href="#/">→ דף הבית</a>
    <article class="prose">
      <h1>הצהרת נגישות</h1>
      <p>לארדו תפריט הוא אתר פנימי ללימוד המוצרים, לעובדי הסניף בלבד. בנינו אותו כך שיהיה נוח לכל העובדים, לפי הנחיות WCAG 2.0 ברמה AA ככל האפשר.</p>
      <h2>מה עשינו</h2>
      <ul>
        <li>האתר בעברית ומימין לשמאל, ומתאים לקוראי מסך.</li>
        <li>הטקסט מתגדל לפי הגדרות הגופן בטלפון, והכפתורים גדולים ונוחים ללחיצה.</li>
        <li>ניגודיות צבעים מספקת, גם במצב כהה.</li>
        <li>לכל תמונה יש תיאור, ואפשר לנווט בכל האתר גם במקלדת.</li>
        <li>מידע לא מועבר בצבע בלבד, ואין אנימציות למי שביקש להפחית תנועה.</li>
      </ul>
      <h2>נתקלתם בבעיה?</h2>
      <p>אם משהו באתר לא נגיש לכם, ספרו לנועם שער או לאחראי המשמרת, ונתקן.</p>
      <p>עודכן לאחרונה: אוקטובר 2026.</p>
    </article>
  `);
}

function viewNotFound() {
  setPage('לא נמצא', `
    <h1>הדף לא נמצא</h1>
    <p><a href="#/">חזרה לדף הבית</a></p>
  `);
}

/* ---------- router ---------- */

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);

  switch (parts[0]) {
    case undefined: viewHome(); break;
    case 'c': viewCategory(parts[1]); break;
    case 'p': viewProduct(parts[1]); break;
    case 'search': viewSearch(params.get('q') || ''); return; // keeps focus in the input
    case 'faq': viewFaq(); break;
    case 'accessibility': viewAccessibility(); break;
    default: viewNotFound();
  }
  focusMain();
}

(async function start() {
  try {
    db = await loadData();
  } catch (err) {
    main.innerHTML = '<p class="empty">לא הצלחנו לטעון את המוצרים. נסו לרענן את הדף.</p>';
    console.error(err);
    return;
  }
  window.addEventListener('hashchange', route);
  route();
})();
