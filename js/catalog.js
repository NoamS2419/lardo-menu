/* Catalog: data loading, categories, product pages, search, info pages. */

import {
  DATA_URL, db, announce, esc, norm, shekel, priceLabel, imgSrc, imgHtml, tagsHtml, productCard, setPage,
  catIcon, placeholder, meter, rosette,
  jerusalemDate
} from './core.js';
import { progress, setKnown, knownCount, streak, today, levelInfo } from './progress.js';
import { burst } from './fx.js';

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
    // Wolt's AI-made photos don't show the real product: treated as no photo at all (games, daily, covers).
    if (p.ai_image) p.image = null;
    p._search = norm([
      p.name, p.description, p.staff_description,
      ...(p.aliases || []), ...(p.ingredients || []), ...(p.choices || []), ...(p.tags || [])
    ].join(' '));
  }
  return { categories, products, byId, byCat, faq: raw.customer_faq || [], updated: raw.updated,
    situations: raw.sales_situations && Array.isArray(raw.sales_situations.items) ? raw.sales_situations : { draft: true, items: [] } };
}

/* ---------- views ---------- */

const ring = (pct, size = 64, r = 27, label = '') => `
  <span class="ring-wrap">
    <svg class="ring" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}"/>
      <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" data-pct="${pct}"/>
    </svg>
    ${label ? `<b>${label}</b>` : ''}
  </span>`;

export { ring };

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : 'ערב טוב';
};

// Same product for the whole team on a given day.
function productOfDay() {
  const pool = db.products.filter((p) => p.image && (p.staff_description || p.description));
  const key = today();
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

export function viewHome() {
  const lvl = levelInfo();
  const days = streak();
  const total = db.products.length;
  const known = knownCount(db.products);
  const daily = productOfDay();
  // A first visit gets one clear way in instead of empty meters and a 0% ring.
  const fresh = !known && !progress.xp && !progress.days.length && !Object.keys(progress.onboard.days).length;
  const ob = progress.onboard;
  const inOnboarding = Object.keys(ob.days).length && !(ob.final && ob.final.passed);
  const primary = inOnboarding ? { href: '#/onboard', label: 'להמשיך את שבוע ראשון' } : { href: '#/learn/all', label: 'להמשיך ללמוד' };
  const dailyDone = progress.daily[jerusalemDate()] != null;

  const cats = db.categories.map((c) => {
    const items = db.byCat.get(c.id);
    const k = knownCount(items);
    const cover = items.find((p) => p.image);
    return `
      <li class="rise">
        <a class="card cat-card" href="#/c/${encodeURIComponent(c.id)}">
          <span class="thumb-wrap">
            ${cover
              ? `<img class="thumb" src="${esc(imgSrc(cover.image, 500))}" alt="" data-pid="${esc(cover.id)}" loading="lazy" decoding="async">`
              : placeholder(c.id, 'thumb')}
            ${k === items.length ? '<span class="cat-done">✓ הכול</span>' : ''}
          </span>
          <span class="cat-name">${esc(c.name)}</span>
          ${k ? `<span class="card-body">
            <span class="meter-row"><span>${k} מתוך ${items.length}</span></span>
            ${meter(k, items.length, `${c.name}: ${k} מתוך ${items.length}`)}
          </span>` : ''}
        </a>
      </li>`;
  }).join('');

  setPage('', `
    <div class="home">
      <aside class="home-side">
        <p class="hello">${greeting()}</p>
        <h1>מה לומדים היום?</h1>
        ${fresh ? `
        <div class="first-run">
          <h2>מתחילים? 5 דקות ביום.</h2>
          <p>שבוע ראשון עובר על הוויטרינה קטגוריה אחרי קטגוריה: כרטיסיות, מבחן קצר, ובסוף תעודה.</p>
          <a class="btn btn-wide" href="#/onboard">להתחיל</a>
        </div>` : `
        <div class="level">
          ${ring(lvl.pct, 64, 27, `${lvl.pct}%`)}
          <span class="level-name">${esc(lvl.name)}</span>
          <span class="level-sub">${lvl.next ? `עוד ${lvl.toNext} נקודות ל${esc(lvl.next)}` : 'הדרגה הגבוהה ביותר'}<br>מוכרים לך ${known} מתוך ${total} מוצרים</span>
          ${days > 1 ? `<span class="streak">${days === 2 ? 'יומיים' : `${days} ימים`} ברצף</span>` : ''}
        </div>
        <a class="btn btn-wide primary-cta" href="${primary.href}">${primary.label}</a>`}
        <nav aria-label="עוד דרכים ללמוד">
          <ul class="secondary">
            <li><a href="#/game/daily">${ICONS.daily}<span>האתגר היומי<small>${dailyDone ? 'הושלם היום. מחר יש אתגר חדש.' : '10 שאלות, זהות לכל הצוות'}</small></span></a></li>
            <li><a href="#/game/what">${ICONS.what}<span>מה זה?<small>רואים תמונה ובוחרים שם</small></span></a></li>
            ${fresh ? '' : `<li><a href="${primary.href === '#/onboard' ? '#/learn/all' : '#/onboard'}">${ICONS.cards}<span>${primary.href === '#/onboard' ? 'כל הכרטיסיות' : 'שבוע ראשון'}<small>${primary.href === '#/onboard' ? 'כל המוצרים. מה שעוד לא ידוע חוזר יותר' : 'מסלול הכניסה לצוות'}</small></span></a></li>`}
          </ul>
        </nav>
        ${daily ? `
        <a class="daily" href="#/p/${encodeURIComponent(daily.id)}">
          <img class="daily-img" src="${esc(imgSrc(daily.image, 700))}" alt="" data-pid="${esc(daily.id)}" decoding="async">
          <span class="daily-body">
            <span class="daily-kicker">המוצר של היום</span>
            <span class="daily-name">${esc(daily.name)}</span>
            <span class="daily-line">${esc(daily.staff_description || daily.description)}</span>
          </span>
        </a>` : ''}
      </aside>
      <section aria-labelledby="cats-h">
        <div class="divider">${rosette()}</div>
        <div class="section-head"><h2 id="cats-h">הוויטרינה</h2></div>
        <ul class="grid">${cats}</ul>
      </section>
    </div>
  `);
}

export function viewCategory(id) {
  const cat = db.categories.find((c) => c.id === id);
  if (!cat) return viewNotFound();
  const items = db.byCat.get(id);
  const k = knownCount(items);
  setPage(cat.name, `
    <a class="back" href="#/"><span aria-hidden="true">→</span> הוויטרינה</a>
    <header class="cat-head">
      <h1>${esc(cat.name)}</h1>
      <p class="cat-line">מוכרים ${k} מתוך ${items.length} · <a href="#/learn/${encodeURIComponent(cat.id)}">לתרגל</a></p>
    </header>
    <ul class="grid">${items.map((p) => productCard(p, !!progress.known[p.id])).join('')}</ul>
  `);
}

const CHECK = '<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

export function viewProduct(id) {
  const p = db.byId.get(id);
  if (!p) return viewNotFound();
  const cat = db.categories.find((c) => c.id === p.category);
  const sizes = (p.sizes && p.sizes.length)
    ? `<ul class="sizes" aria-label="גדלים ומחירים">${p.sizes.map((s) =>
         `<li>${esc(s.label)}: <strong><bdi>${esc(shekel(s.price) ?? '?')}</bdi></strong></li>`).join('')}</ul>`
    : `<p class="big-price"><bdi>${esc(priceLabel(p))}</bdi></p>`;
  // Skip the chips when they only repeat the description word for word.
  const sameAsDesc = norm((p.ingredients || []).join(' ')) === norm((p.description || '').replace(/,/g, ' '));
  const chips = (title, arr) => (arr && arr.length)
    ? `<h2>${title}</h2><ul class="ingredients">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '';
  const notes = (p.notes && p.notes.length)
    ? `<ul class="notes">${p.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';
  const notWolt = p.is_wolt === false
    ? '<p class="note">נמכר בדלפק בלבד, לא מופיע בוולט.</p>'
    : '';
  const knowLabel = (on) => on ? `${CHECK} מוכר לי` : 'סימון: מוכר לי';
  const known = !!progress.known[p.id];
  setPage(p.name, `
    ${cat ? `<a class="back" href="#/c/${encodeURIComponent(cat.id)}"><span aria-hidden="true">→</span> ${esc(cat.name)}</a>` : ''}
    <article class="product">
      <div class="product-media">${imgHtml(p, 'product-hero', 900)}${p.ai_image ? '<p class="ph-note">עוד אין תמונה אמיתית</p>' : ''}</div>
      <div>
        <h1>${esc(p.name)}${p.unit ? ` <span class="unit">(${esc(p.unit)})</span>` : ''}</h1>
        ${(p.aliases && p.aliases.length) ? `<p class="aka">נקרא גם: ${p.aliases.map(esc).join(', ')}</p>` : ''}
        ${sizes}
        ${tagsHtml(p.tags)}
        ${p.staff_description && p.staff_description !== p.description
          ? `<div class="staff"><span class="staff-title">מה אומרים בצוות</span><p>${esc(p.staff_description)}</p></div>` : ''}
        ${p.description && sameAsDesc ? `<h2>מה יש בפנים</h2><p>${esc(p.description)}</p>` : ''}
        ${sameAsDesc ? '' : chips('מה יש בפנים', p.ingredients)}
        ${chips('טעמים', p.choices)}
        ${salesHtml(p)}
        ${notes}
        ${notWolt}
        <button class="btn know${known ? ' on' : ''}" id="know" type="button" aria-pressed="${known}">${knowLabel(known)}</button>
      </div>
    </article>
  `);
  document.getElementById('know').addEventListener('click', () => {
    setKnown(p.id, !progress.known[p.id]);
    const b = document.getElementById('know');
    const on = !!progress.known[p.id];
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = knowLabel(on);
    if (on) burst(b, 18);
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
      ? `<ul class="grid">${found.map((p) => productCard(p, Boolean(progress.known[p.id]))).join('')}</ul>`
      : `<div class="state">
          ${rosette()}
          <h2>אין תוצאות ל"${esc(input.value.trim())}"</h2>
          <p>אפשר לחפש לפי שם או מרכיב. למשל:</p>
          <ul class="chips">${['פיסטוק', 'קרואסון', 'שוקולד', 'טארט', 'כריך'].map((w) => `<li><a href="#/search?q=${encodeURIComponent(w)}">${w}</a></li>`).join('')}</ul>
        </div>`;
    announce(found.length ? (found.length === 1 ? 'נמצא מוצר אחד' : `נמצאו ${found.length} מוצרים`) : 'לא נמצאו מוצרים');
  };
  document.getElementById('search-form').addEventListener('submit', (e) => { e.preventDefault(); input.blur(); });
  input.addEventListener('input', run);
  run();
  input.focus();
}

/* ---------- selling: a pitch line and what to offer alongside (staff-editable, may still be a draft) ---------- */

const draftNote = '<p class="draft-note"><span class="draft-badge">טיוטה</span> ממתין לאישור.</p>';
// Two products can share a name (personal and whole lemon tart): the chip then says which one.
const KIND = { patisserie: 'אישי', tarts: 'שלם', cakes: 'בפס' };
const chipName = (p) => {
  const twin = db.products.some((o) => o.id !== p.id && norm(o.name) === norm(p.name));
  if (!twin) return p.name;
  const cat = db.categories.find((c) => c.id === p.category);
  return `${p.name} (${KIND[p.category] || (cat ? cat.name : '')})`;
};
const productLinks = (list) => `<ul class="chips">${list
  .filter((x) => db.byId.has(x.id))
  .map((x) => `<li><a href="#/p/${encodeURIComponent(x.id)}">${esc(chipName(db.byId.get(x.id)))}</a></li>`).join('')}</ul>`;

function salesHtml(p) {
  const s = p.sales;
  if (!s || (!s.pitch && !(s.pair_with || []).length)) return '';
  return `
    <section class="sell" aria-labelledby="sell-h">
      <h2 id="sell-h">איך מציעים</h2>
      ${s.pitch ? `<p class="pitch">${esc(s.pitch)}</p>` : ''}
      ${(s.pair_with || []).length ? `<h3>מה להציע ליד</h3>${productLinks(s.pair_with)}` : ''}
      ${s.draft ? draftNote : ''}
    </section>`;
}

export function viewSell() {
  const sit = db.situations;
  setPage('טיפים למכירה', `
    <a class="back" href="#/"><span aria-hidden="true">→</span> דף הבית</a>
    <article class="prose">
      <h1>טיפים למכירה</h1>
      <p>מה מציעים כשלקוח מבקש משהו מסוים. בכל דף מוצר יש גם "איך מציעים" ומה להציע ליד.</p>
      ${sit.draft ? draftNote : ''}
      ${sit.items.length ? sit.items.map((t) => `
        <section class="situation">
          <h2>${esc(t.title)}</h2>
          <p>${esc(t.tip)}</p>
          ${(t.products || []).length ? productLinks(t.products) : ''}
        </section>`).join('') : '<p class="empty">עוד אין טיפים.</p>'}
    </article>
  `);
}

export function viewFaq() {
  setPage('שאלות של לקוחות', `
    <a class="back" href="#/"><span aria-hidden="true">→</span> דף הבית</a>
    <article class="prose">
      <h1>שאלות של לקוחות</h1>
      <p class="note">כשלקוח שואל על הריון, כשרות או רגישות ואתם לא בטוחים, הפנו אותו לאחראי המשמרת. אל תבטיחו "בטוח" או "כשר" על דעת עצמכם.</p>

      ${db.faq.map((f) => `<h2>${esc(f.topic)}</h2><p>${esc(f.text)}</p>`).join('')}
    </article>
  `);
}

export function viewAccessibility() {
  setPage('הצהרת נגישות', `
    <a class="back" href="#/"><span aria-hidden="true">→</span> דף הבית</a>
    <article class="prose">
      <h1>הצהרת נגישות</h1>
      <p>לארדו תפריט הוא אתר פנימי ללימוד המוצרים, לצוות הסניף בלבד. השתדלנו לבנות אותו לפי הנחיות WCAG 2.0 ברמה AA, אבל הוא לא עבר בדיקה של מורשה נגישות.</p>
      <h2>מה עשינו</h2>
      <ul>
        <li>האתר בעברית ומימין לשמאל, ונבנה כך שיעבוד עם קוראי מסך.</li>
        <li>הטקסט מתגדל לפי הגדרות הגופן בטלפון, והכפתורים גדולים ונוחים ללחיצה.</li>
        <li>ניגודיות צבעים מספקת, גם במצב כהה.</li>
        <li>לכל תמונה יש תיאור, ואפשר לנווט בכל האתר גם במקלדת.</li>
        <li>מידע לא מועבר בצבע בלבד, ואין אנימציות למי שביקש להפחית תנועה.</li>
        <li>במשחקים אין מעבר אוטומטי לשאלה הבאה אלא אם מפעילים אותו ב"הגדרות משחק" בעמוד המשחקים. רק ב"נגד השעון" יש שעון, ואפשר לבחור בו שתי דקות או בלי שעון בכלל.</li>
      </ul>
      <h2>מגבלות ידועות</h2>
      <ul>
        <li>תמונות המוצרים מגיעות מוולט. אם תמונה לא נטענת, מוצג במקומה איור של הקטגוריה.</li>
        <li>במשחק "מה זה?" מי שלא רואה את התמונה מקבל רמז מילולי מהתיאור, שהוא פחות מדויק מהתמונה.</li>
        <li>חלק מהמוצרים עוד בלי תמונה ובלי תיאור מלא.</li>
      </ul>
      <p>נבדק באוקטובר 2026 עם מקלדת ובכלים אוטומטיים.</p>
      <h2>נתקלתם בבעיה?</h2>
      <p>אם משהו באתר לא נגיש לכם, ספרו לנועם שער או לאחראי המשמרת, ונתקן.</p>
      <p>עודכן לאחרונה: אוקטובר 2026.</p>
    </article>
  `);
}

const ICONS = {
  daily: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M9 15l2 2 4-4"/></svg>',
  what: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>',
  cards: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="15" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/></svg>',
};

export function viewNotFound() {
  setPage('לא נמצא', `
    <div class="state">
      ${rosette()}
      <h1>הדף הזה לא קיים</h1>
      <p>אולי הקישור ישן, או שהמוצר ירד מהתפריט.</p>
      <a class="btn" href="#/">לדף הבית</a>
    </div>
  `);
}
