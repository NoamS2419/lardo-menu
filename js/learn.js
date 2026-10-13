/* Learning: flashcards and games. */

import { db, announce, esc, norm, priceLabel, imgSrc, imgHtml, family, setPage, catIcon, meter, fillMeters, prefersReducedMotion } from './core.js';
import { progress, saveProgress, markResult, setKnown, knownCount, addXp, levelInfo, streak } from './progress.js';
import { viewNotFound, ring } from './catalog.js';
import { burst, shower, countUp } from './fx.js';
import { cloudEnabled, myPlayer, submitDaily, syncTotal } from './cloud.js';

/* ---------- random helpers ---------- */

// Swappable random source: the daily challenge uses a seeded one so the whole team gets the same questions.
let rand = Math.random;

// Small deterministic PRNG (mulberry32) seeded from a string such as a date.
function seeded(key) {
  let a = 0;
  for (const ch of key) a = (Math.imul(a, 31) + ch.charCodeAt(0)) | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Items the employee misses more, or hasn't marked as known, come up first.
function weightedOrder(items) {
  return items
    .map((p) => ({ p, w: (progress.known[p.id] ? 0 : 2) + (progress.miss[p.id] || 0) * 2 + rand() * 2.5 }))
    .sort((a, b) => b.w - a.w)
    .map((x) => x.p);
}

const pick = (arr, n) => shuffle(arr).slice(0, n);

/* ---------- product "clue" when there is no photo yet ---------- */

// Description with the product's own name and aliases blanked out, for screen-reader users
// who can't see the photo. Empty when there is nothing safe to say.
export function hintText(p) {
  const text = [p.staff_description, p.description].find((t) => t) || (p.ingredients || []).join(', ');
  const nameWords = [p.name, ...(p.aliases || [])]
    .flatMap((n) => norm(n).split(' ')).filter((w) => w.length > 2);
  // Blank whole words that share a stem with the name, keeping punctuation.
  return text.split(/(\s+)/).map((tok) => {
    const core = norm(tok.replace(/[.,;:!?()]/g, ''));
    return core.length > 1 && nameWords.some((w) => core.includes(w) || w.includes(core) && core.length > 3)
      ? tok.replace(/[^.,;:!?()\s]+/, '…') : tok;
  }).join('').replace(/(…\s*){2,}/g, '… ').trim();
}

export function clueHtml(p) {
  if (p.image) {
    const hint = hintText(p);
    return `<img class="quiz-img" src="${esc(imgSrc(p.image, 600))}" alt="תמונת מוצר" data-pid="${esc(p.id)}" decoding="async">
      ${hint ? `<p class="sr-only">רמז: ${esc(hint)}</p>` : ''}`;
  }
  const ing = (p.ingredients || []).map((i) => `<li>${esc(i)}</li>`).join('');
  return `
    <div class="clue">
      <p class="clue-label">עוד אין תמונה. המרכיבים:</p>
      <ul class="ingredients">${ing}</ul>
    </div>`;
}

/* ---------- learn hub ---------- */

export function viewLearnHub() {
  const total = db.products.length;
  const done = knownCount(db.products);
  const rows = db.categories.map((c) => {
    const items = db.byCat.get(c.id);
    const k = knownCount(items);
    return `
      <li class="rise">
        <a class="row-link tint-${esc(c.id)}" href="#/learn/${encodeURIComponent(c.id)}">
          ${catIcon(c.id)}
          <span class="row-title">${esc(c.name)}</span>
          <span class="row-sub">${k}/${items.length}</span>
          ${meter(k, items.length, `${c.name}: ${k} מתוך ${items.length}`)}
        </a>
      </li>`;
  }).join('');
  setPage('כרטיסיות', `
    <h1>כרטיסיות</h1>
    <p>רואים את המוצר, נזכרים בשם, והופכים את הכרטיס. מה שלא ידעת יחזור אלייך יותר.</p>
    <div class="level">
      ${ring(total ? Math.round((done / total) * 100) : 0, 64, 27, `${total ? Math.round((done / total) * 100) : 0}%`)}
      <span class="level-name">מוכרים: ${done} מתוך ${total}</span>
      <span class="level-sub">כל מוצר שסימנת שווה 5 נקודות</span>
      <span><a class="btn" href="#/learn/all">לכל המוצרים</a></span>
    </div>
    <h2>לפי קטגוריה</h2>
    <ul class="rows">${rows}</ul>
  `);
}

/* ---------- flashcards ---------- */

export function viewFlashcards(catId) {
  const items = catId === 'all' ? db.products : db.byCat.get(catId);
  const cat = db.categories.find((c) => c.id === catId);
  if (!items) return viewNotFound();
  const title = cat ? cat.name : 'כל המוצרים';
  let deck = weightedOrder(items);
  let pos = 0;
  let seen = 0;
  let knewInRow = 0;

  setPage(`כרטיסיות: ${title}`, `
    <a class="back" href="#/learn"><span aria-hidden="true">→</span> כרטיסיות</a>
    <h1>${esc(title)}</h1>
    <div id="fc"></div>
  `);
  const box = document.getElementById('fc');

  function render() {
    if (pos >= deck.length) return finish();
    const p = deck[pos];
    // No photo and no ingredients: nothing to guess the name from, so ask the price instead.
    const shared = sharedPhoto(p);
    const bare = (!p.image || (shared && !hintText(p))) && !(p.ingredients || []).length;
    // A photo several products share can't tell them apart: give the text hint instead.
    const clue = shared && hintText(p) ? `<blockquote class="who-quote">${esc(hintText(p))}</blockquote>` : clueHtml(p);
    const catName = (db.categories.find((c) => c.id === p.category) || {}).name || '';
    box.innerHTML = `
      <div class="flip q-in" id="card">
        <div class="flip-inner">
          <section class="face face-front" aria-label="צד קדמי">
            <p class="counter">כרטיס ${seen + 1} · מוכרים ${knownCount(items)}/${items.length}</p>
            ${bare
              ? `<p class="flash-name">${esc(p.name)}</p><p class="counter">${esc(catName)}</p>
                 <p class="flash-q" tabindex="-1" id="fq">כמה זה עולה?</p>`
              : `${clue}
                 <p class="flash-q" tabindex="-1" id="fq">איך קוראים לזה?</p>`}
            <button class="btn btn-wide" id="flip" type="button">הפוך</button>
          </section>
          <section class="face face-back" aria-label="התשובה" hidden>
            ${imgHtml(p, 'quiz-img', 600, '')}
            <h2 class="flash-name" tabindex="-1" id="ans">${esc(p.name)}</h2>
            <p class="price"><bdi>${esc(priceLabel(p))}</bdi></p>
            ${(p.staff_description || p.description) ? `<p>${esc(p.staff_description || p.description)}</p>` : ''}
            <div class="two">
              <button class="btn btn-no" id="no" type="button">✗ עוד לא</button>
              <button class="btn btn-yes" id="yes" type="button">✓ ידעתי</button>
            </div>
          </section>
        </div>
      </div>`;
    document.getElementById('flip').addEventListener('click', flip);
    document.getElementById('yes').addEventListener('click', (e) => answer(true, e.currentTarget));
    document.getElementById('no').addEventListener('click', () => answer(false));
  }

  function flip() {
    const card = document.getElementById('card');
    const back = card.querySelector('.face-back');
    back.hidden = false;
    card.classList.add('flipped');
    card.querySelector('.face-front').setAttribute('aria-hidden', 'true');
    card.querySelector('.face-front').inert = true;
    document.getElementById('ans').focus({ preventScroll: true });
  }

  function answer(knew, btn) {
    const p = deck[pos];
    markResult(p.id, knew);
    if (knew) {
      if (!progress.known[p.id]) addXp(2); // no repeat points for a card already known
      setKnown(p.id, true);
      knewInRow += 1;
      if (knewInRow % 5 === 0) burst(btn, 22);
    } else {
      knewInRow = 0;
      deck.splice(Math.min(deck.length, pos + 4), 0, p); // comes back in a few cards
    }
    pos += 1;
    seen += 1;
    render();
    document.getElementById('fq')?.focus({ preventScroll: true });
  }

  function finish() {
    const k = knownCount(items);
    box.innerHTML = `
      <section class="flash result q-in">
        ${ring(Math.round((k / items.length) * 100), 150, 64, `<span id="pct">0</span>%`)}
        <h2 tabindex="-1" id="done">סיימת את החבילה!</h2>
        <p>מוכרים לך ${k} מתוך ${items.length} מוצרים כאן.</p>
        <p><button class="btn" id="again" type="button">עוד סיבוב</button></p>
      </section>`;
    fillMeters(box);
    countUp(document.getElementById('pct'), Math.round((k / items.length) * 100));
    if (k === items.length) shower();
    window.scrollTo(0, 0);
    document.getElementById('done').focus({ preventScroll: true });
    document.getElementById('again').addEventListener('click', () => {
      deck = weightedOrder(items); pos = 0; seen = 0; knewInRow = 0; render();
    });
  }

  render();
}

/* ---------- games ---------- */

const GAME_ICONS = {
  what: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  made: '<path d="M5 11h14l-1.8 9H6.8z"/><path d="M5 11a7 7 0 0 1 14 0"/>',
  price: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  who: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/><path d="M9 9.5a2 2 0 1 1 2.5 2c-.5.2-.5.6-.5 1"/>',
  customer: '<path d="M4 5h16v10H9l-5 4z"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>'
};
const gameIcon = (id) => `<svg class="game-icon" viewBox="0 0 24 24" aria-hidden="true">${GAME_ICONS[id]}</svg>`;

const GAMES = [
  { id: 'what', name: 'מה זה?', desc: 'רואים מוצר ובוחרים את השם הנכון.', ready: true },
  { id: 'made', name: 'ממה זה עשוי?', desc: 'שם של מוצר, ובוחרים מה יש בו.', ready: true },
  { id: 'price', name: 'כמה זה עולה?', desc: 'רואים מוצר ובוחרים את המחיר הנכון.', ready: true },
  { id: 'who', name: 'מי המוצר?', desc: 'קוראים תיאור ומזהים את המוצר.', ready: true },
  { id: 'customer', name: 'שאלת לקוח', desc: 'שאלות אמיתיות מהדלפק: כשרות, הריון, נסיעה.', ready: true },
  { id: 'clock', name: 'נגד השעון', desc: 'כמה שיותר תשובות נכונות בדקה.', ready: true }
];

export function viewGames() {
  const lvl = levelInfo();
  const items = GAMES.map((g) => {
    const best = progress.best[g.id === 'clock' ? 'clock60' : g.id];
    return g.ready
      ? `<li class="rise"><a class="row-link" href="#/game/${g.id}">
           ${gameIcon(g.id)}
           <span class="row-title">${esc(g.name)}</span>
           ${best ? `<span class="soon">שיא ${Number(best.score)}${g.id === 'clock' ? ' בדקה' : `/${Number(best.of)}`}</span>` : '<span></span>'}
           <span class="row-sub full">${esc(g.desc)}</span>
         </a></li>`
      : `<li class="rise"><span class="row-link disabled" aria-disabled="true">
           ${gameIcon(g.id)}
           <span class="row-title">${esc(g.name)}</span>
           <span class="soon">בקרוב</span>
           <span class="row-sub full">${esc(g.desc)}</span>
         </span></li>`;
  }).join('');
  setPage('משחקים', `
    <h1>משחקים</h1>
    <div class="level">
      ${ring(lvl.pct)}
      <span class="level-name">${esc(lvl.name)} · ${lvl.points} נקודות</span>
      <span class="level-sub">${lvl.next ? `עוד ${lvl.toNext} נקודות ל${esc(lvl.next)}` : 'הגעת לדרגה הכי גבוהה!'}</span>
      <span class="level-sub">כל תשובה נכונה: 10 נקודות</span>
    </div>
    <h2>איזה משחק?</h2>
    <ul class="rows">${items}</ul>
    ${badgesHtml()}
  `);
}

/* ---------- badges: earned from personal progress, kept on this phone ---------- */

const perfect = (id) => { const b = progress.best[id]; return Boolean(b && b.score >= ROUND && b.of >= ROUND); };

function badges() {
  const list = [
    { icon: '🥐', name: 'כתר הקרואסונים', how: 'מכירים את כל המאפים', got: () => (db.byCat.get('pastries') || []).every((p) => progress.known[p.id]) },
    { icon: '💰', name: 'מחירון מהלך', how: '10 מתוך 10 ב"כמה זה עולה?"', got: () => perfect('price') },
    { icon: '👀', name: 'עין של קונדיטור', how: '10 מתוך 10 ב"מה זה?"', got: () => perfect('what') },
    { icon: '🧾', name: 'קריאת מתכונים', how: '10 מתוך 10 ב"ממה זה עשוי?"', got: () => perfect('made') },
    { icon: '🔎', name: 'עין של בלש', how: '10 מתוך 10 ב"מי המוצר?"', got: () => perfect('who') },
    { icon: '🛎️', name: 'שירות מושלם', how: '10 מתוך 10 ב"שאלת לקוח"', got: () => perfect('customer') },
    { icon: '⚡', name: 'ידיים מהירות', how: '15 נכונות בדקה ב"נגד השעון"', got: () => (progress.best.clock60 || {}).score >= 15 },
    { icon: '🏅', name: 'אליפות היום', how: '10 מתוך 10 באתגר היומי', got: () => Object.values(progress.daily).some((v) => v >= ROUND) },
    { icon: '🔥', name: 'שבוע ברצף', how: 'לומדים 7 ימים ברצף', got: () => streak() >= 7 },
    { icon: '🎓', name: 'כל הוויטרינה בראש', how: 'כל המוצרים מסומנים "מוכר לי"', got: () => db.products.every((p) => progress.known[p.id]) }
  ];
  return list.map((b) => ({ ...b, got: b.got() }));
}

function badgesHtml() {
  const all = badges();
  const n = all.filter((b) => b.got).length;
  return `
    <h2>תגים <span class="counter">(${n} מתוך ${all.length})</span></h2>
    <ul class="badges">${all.map((b) => `
      <li class="badge${b.got ? ' got' : ''}">
        <span class="badge-icon" aria-hidden="true">${b.icon}</span>
        <span class="badge-name">${esc(b.name)}</span>
        ${b.got ? '<span class="badge-got">✓ הושג</span>' : ''}
        <span class="badge-how">${b.got ? '' : '<span class="sr-only">עוד לא. </span>'}${esc(b.how)}</span>
      </li>`).join('')}
    </ul>`;
}

const PRAISE = ['בול!', 'יש!', 'נכון!', 'בדיוק ככה', 'יפה מאוד!', 'עין של קונדיטור'];
const STREAK_PRAISE = { 3: 'שלוש ברצף!', 5: 'חמש ברצף! 🔥', 8: 'שמונה ברצף! מי עוצר אותך?' };

const ROUND = 10;

// Some products share one Wolt photo (three breads, for one). A photo is only a fair question when it's unique.
const photoKey = (p) => {
  if (!p.image) return '';
  const base = String(p.image).split('?')[0].split('/').pop();
  return base.startsWith(`${p.id}-`) ? base.slice(p.id.length + 1) : base;
};
let photoCounts = null;
const sharedPhoto = (p) => {
  if (!photoCounts) {
    photoCounts = new Map();
    for (const o of db.products) { const k = photoKey(o); if (k) photoCounts.set(k, (photoCounts.get(k) || 0) + 1); }
  }
  return (photoCounts.get(photoKey(p)) || 0) > 1;
};

function questionsWhat(order = weightedOrder) {
  const showable = db.products.filter((p) => p.image && hintText(p) && !sharedPhoto(p));
  const pool = order(showable).slice(0, ROUND);
  return pool.map((p) => {
    // Distractors never share the answer's name (some names repeat across categories).
    const names = new Set([norm(p.name)]);
    const wrong = [];
    const fam = db.products.filter((o) => family(o) === family(p));
    for (const o of [...shuffle(db.byCat.get(p.category)), ...shuffle(fam), ...shuffle(db.products)]) {
      if (wrong.length === 3) break;
      if (names.has(norm(o.name)) || photoKey(o) === photoKey(p)) continue;
      names.add(norm(o.name));
      wrong.push(o);
    }
    const options = shuffle([p, ...wrong]).map((o) => o.name);
    return {
      id: p.id,
      prompt: clueHtml(p),
      kind: 'מה זה?',
      options,
      correct: options.indexOf(p.name),
      explain: `${p.name}. ${p.description || ''}`
    };
  });
}

// Basics that might be in almost anything, so they can't be a fair wrong answer.
const GENERIC = ['מלח', 'עגבני', 'שמן זית', 'חמאה', 'בצל', 'סוכר', 'ביצ', 'קמח', 'חלב', 'שמנת', 'וניל']
  .map(norm);

// Short phrases make fair answers; long Wolt sentences give the answer away.
const isShort = (i) => i.length <= 28 && i.split(' ').length <= 4;
const words = (s) => norm(s).split(' ').filter((w) => w.length > 2);

// Correct answers for "made of": not already in the product's name.
const madeAnswers = (p) => (p.ingredients || [])
  .filter(isShort)
  .filter((i) => !words(i).some((w) => norm(p.name).includes(w)));

function questionsMade(order = weightedOrder) {
  const eligible = db.products.filter((p) => madeAnswers(p).length >= 1 && (p.ingredients || []).length >= 2);
  const pool = order(eligible).slice(0, ROUND);
  return pool.map((p) => {
    const mine = norm([p.name, p.description, p.staff_description, ...(p.ingredients || [])].join(' '));
    const fair = (i) => !mine.includes(norm(i))
      && !words(i).some((w) => w.length > 3 && mine.includes(w))
      && !GENERIC.some((g) => norm(i).includes(g));
    // Wrong answers from the same category first, so they look plausible.
    const sameCat = db.byCat.get(p.category).filter((o) => o.id !== p.id).flatMap((o) => o.ingredients || []);
    const fam = db.products.filter((o) => family(o) === family(p)).flatMap((o) => o.ingredients || []);
    const others = db.products.flatMap((o) => o.ingredients || []);
    const wrong = [];
    for (const i of [...shuffle(sameCat), ...shuffle(fam), ...shuffle(others)]) {
      if (wrong.length === 3) break;
      if (isShort(i) && fair(i) && !wrong.some((w) => norm(w) === norm(i))) wrong.push(i);
    }
    const right = pick(madeAnswers(p), 1)[0];
    const options = shuffle([right, ...wrong]);
    return {
      id: p.id,
      prompt: `<p class="flash-q">מה יש ב<strong>${esc(p.name)}</strong>?</p>`,
      options,
      correct: options.indexOf(right),
      explain: `${p.name}: ${p.description || (p.ingredients || []).join(', ')}`
    };
  });
}

// Distinct names for distractors: same category first, then same family, then anything.
function nameDistractors(p, n = 3) {
  const names = new Set([norm(p.name)]);
  const out = [];
  const fam = db.products.filter((o) => family(o) === family(p));
  for (const o of [...shuffle(db.byCat.get(p.category)), ...shuffle(fam), ...shuffle(db.products)]) {
    if (out.length === n) break;
    if (names.has(norm(o.name))) continue;
    names.add(norm(o.name));
    out.push(o);
  }
  return out;
}

const basePrice = (p) => (typeof p.price === 'number' ? p.price : null);

function questionsPrice(order = weightedOrder) {
  const eligible = db.products.filter((p) => basePrice(p) != null);
  const pool = order(eligible).slice(0, ROUND);
  return pool.map((p) => {
    const right = basePrice(p);
    // Wrong prices: real prices from the same family that are close, so it takes knowing, not guessing.
    const near = [...new Set(db.products
      .filter((o) => family(o) === family(p))
      .map(basePrice).filter((x) => x != null && x !== right))]
      .sort((a, b) => Math.abs(a - right) - Math.abs(b - right));
    const wrong = shuffle(near.slice(0, 5)).slice(0, 3);
    for (const d of [4, -4, 8, -8, 10, -10]) {
      if (wrong.length >= 3) break;
      const x = right + d;
      if (x > 0 && x !== right && !wrong.includes(x)) wrong.push(x);
    }
    const options = shuffle([right, ...wrong]).map((x) => `${x} ₪`);
    const sizes = (p.sizes || []).length ? ` (${p.sizes[0].label})` : '';
    return {
      id: p.id,
      prompt: `${clueHtml(p)}<p class="flash-q">כמה עולה <strong>${esc(p.name)}</strong>${esc(sizes)}?</p>`,
      options,
      correct: options.indexOf(`${right} ₪`),
      explain: `${p.name}${sizes}: ${right} ₪`
    };
  });
}

function questionsWho(order = weightedOrder) {
  const eligible = db.products.filter((p) => hintText(p).replace(/[….,\s]/g, '').length >= 12);
  const pool = order(eligible).slice(0, ROUND);
  return pool.map((p) => {
    const options = shuffle([p, ...nameDistractors(p)]).map((o) => o.name);
    return {
      id: p.id,
      prompt: `<blockquote class="who-quote">${esc(hintText(p))}</blockquote><p class="flash-q">איזה מוצר זה?</p>`,
      options,
      correct: options.indexOf(p.name),
      explain: `${p.name}. ${p.staff_description || p.description || ''}`
    };
  });
}

/* ---------- daily challenge ---------- */

// The shop's calendar day, the same on every phone.
export const jerusalemDate = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

/* "שאלת לקוח": counter questions built from the staff notes (tags) and the customer FAQ. */
const KOSHER = { yes: 'כן, כשרות רעננה בלי חלב נוכרי', no: 'לא, זה חלב נוכרי' };
const PREG = {
  ok: 'אפשר, הכול מפוסטר',
  no: 'לא מומלץ',
  maybe: 'אולי עדיף לוותר (גבינה במים)'
};
const hasTag = (p, t) => (p.tags || []).includes(t);
const pregOf = (p) => hasTag(p, 'לא מומלץ בהריון') ? 'no' : hasTag(p, 'אולי לא מומלץ בהריון') ? 'maybe' : 'ok';
// Staff notes worth saying at the counter (no data-fix notes, no allergens: the site doesn't cover them).
const noteOf = (p, skip = '') => (p.notes || []).filter((n) => !/וולט|תוקן|גלוטן/.test(n) && !skip.includes(n)).join('. ');

// Suez One draws ₪ like "שח"; amounts go in the body font.
const nums = (html) => html.replace(/(\d+(?:\.\d+)? ₪)/g, '<bdi class="num">$1</bdi>');

// The customer's question leads, as a speech bubble; the product photo is a small hint under it.
const bubble = (html, who, p) => `
  <p class="ask-bubble"><span class="ask-who">${who}:</span> ${html}</p>
  ${p ? `<div class="clue-small">${clueHtml(p)}</div>` : ''}`;

// Shuffled options with the right one found by its text, so its position teaches nothing.
const choices = (opts, right) => {
  const options = shuffle(opts);
  return { options, correct: options.indexOf(opts[right]) };
};

function questionsCustomer(order = weightedOrder) {
  const qs = [];
  // Kosher: every tagged product, balanced with plain sweet products of the same kind.
  // Anything that mentions gianduja (or has two flavors) stays out of the "plain" side.
  const textOf = (p) => [p.name, p.description, p.staff_description, ...(p.ingredients || []), ...(p.notes || [])].join(' ');
  const GIANDUJA = /ג׳?א?נדויה|גנדויה|נוכרי|דולצ׳ה/;
  const dairy = db.products.filter((p) => hasTag(p, 'חלב נוכרי') && !(p.notes || []).length);
  const plainSweet = db.products.filter((p) => !hasTag(p, 'חלב נוכרי') && family(p) === 'sweet' && !GIANDUJA.test(textOf(p)));
  for (const p of [...order(dairy).slice(0, 3), ...order(plainSweet).slice(0, 2)]) {
    const isDairy = hasTag(p, 'חלב נוכרי');
    const options = [KOSHER.yes, KOSHER.no];
    qs.push({
      id: p.id,
      prompt: bubble(`<strong>${esc(p.name)}</strong>, זה בלי חלב נוכרי?`, 'לקוח שואל', p),
      options,
      correct: isDairy ? 1 : 0,
      explain: isDairy
        ? `${p.name}: חלב נוכרי. ${noteOf(p) || 'כל מה שעם ג׳אנדויה הוא חלב נוכרי, וגם פאן סוויס.'}`
        : `${p.name}: כשרות רעננה. חלב נוכרי יש רק בג׳אנדויה ובפאן סוויס.`
    });
  }
  // Pregnancy: tagged products plus a couple of safe ones.
  const flagged = db.products.filter((p) => pregOf(p) !== 'ok');
  // "Safe" examples avoid anything the FAQ calls out (cheese in water, meringue), tagged or not.
  const safe = db.products.filter((p) => pregOf(p) === 'ok' && family(p) === 'savory'
    && !/בוראטה|סטראצ׳אטלה|פטה|סלק|לימון|גבינה|מרנג/.test(textOf(p)));
  for (const p of [...order(flagged).slice(0, 3), ...order(safe).slice(0, 2)]) {
    const k = pregOf(p);
    const options = [PREG.ok, PREG.no, PREG.maybe];
    const why = noteOf(p, PREG[k]);
    qs.push({
      id: p.id,
      prompt: bubble(`אני בהריון. אפשר <strong>${esc(p.name)}</strong>?`, 'לקוחה שואלת', p),
      options,
      correct: ['ok', 'no', 'maybe'].indexOf(k),
      explain: k === 'ok' ? `${p.name}: אפשר. עקרונית הכול מפוסטר.` : `${p.name}: ${PREG[k]}.${why ? ` ${why}.` : ''}`
    });
  }
  // From the FAQ.
  qs.push({
    id: 'faq:travel',
    prompt: bubble('זה יחזיק נסיעה של שעה באוטו?', 'לקוח שואל'),
    ...choices(['בלי בעיה, גם שלוש שעות', 'חצי שעה בטוח, שעה זה גבולי', 'רק אם זה במקרר', 'לא, צריך לאכול מיד'], 1),
    explain: 'מחזיק נסיעה של חצי שעה באוטו; שעה זה גבולי.'
  });
  qs.push({
    id: 'faq:freeze',
    prompt: bubble('אני קונה היום לאירוע בעוד כמה ימים. איך שומרים?', 'לקוחה שואלת'),
    ...choices(['לשמור במקפיא ולהוציא שעה לפני', 'לשמור במקרר עד האירוע', 'לא כדאי, רק לקנות ביום עצמו', 'לחמם בתנור לפני ההגשה'], 0),
    explain: 'הכול קפוא. אפשר לשמור כמה ימים במקפיא ולהוציא שעה לפני שאוכלים.'
  });
  qs.push({
    id: 'faq:dolce',
    prompt: bubble('מקל קרואסון בטעם דולצ׳ה, זה חלב נוכרי?', 'לקוח שואל'),
    ...choices(['לא, דולצ׳ה זה כשרות רעננה בלי חלב נוכרי', 'כן, כל המקלות חלב נוכרי'], 0),
    explain: 'ג׳אנדויה: חלב נוכרי. דולצ׳ה (שוקולד לבן מקורמל): כשרות רעננה בלי חלב נוכרי.'
  });
  return shuffle(qs).slice(0, ROUND);
}

// 10 questions, identical for the whole team on a given day: a mix of four games.
function questionsDaily() {
  const date = jerusalemDate();
  rand = seeded(`lardo-${date}`);
  try {
    const plain = (items) => shuffle(items);
    const pools = [[questionsWhat(plain), 3], [questionsMade(plain), 2], [questionsPrice(plain), 3], [questionsWho(plain), 2]];
    // One question per product; if a pool runs short, the others top up to a full round.
    const seen = new Set();
    const qs = [];
    const take = (pool, n) => {
      for (const q of pool) {
        if (n <= 0 || qs.length >= ROUND) break;
        if (!seen.has(q.id)) { seen.add(q.id); qs.push(q); n -= 1; }
      }
    };
    for (const [pool, n] of pools) take(pool, n);
    for (const [pool] of pools) take(pool, ROUND);
    return shuffle(qs);
  } finally {
    rand = Math.random;
  }
}

// "Worth another look": the products answered wrong, each linking to its page.
function missedHtml(missed) {
  const items = [...new Set(missed)].map((pid) => db.byId.get(pid)).filter(Boolean);
  return items.length
    ? `<h3>כדאי לחזור על</h3>
       <ul class="missed">${items.map((p) => `
         <li><a href="#/p/${encodeURIComponent(p.id)}">${imgHtml(p, 'mini', 120, '')}<span>${esc(p.name)}</span></a></li>`).join('')}
       </ul>`
    : '';
}

/* ---------- "נגד השעון": as many right answers as possible before time runs out ---------- */

const CLOCK_MODES = [
  { secs: 60, label: 'דקה' },
  { secs: 120, label: 'שתי דקות' },
  { secs: 0, label: 'בלי שעון (תרגול, 20 שאלות)' }
];

function viewClock() {
  const b60 = progress.best.clock60;
  const b120 = progress.best.clock120;
  setPage('נגד השעון', `
    <section class="flash clock-start">
      <h1>נגד השעון</h1>
      <p>תמונות, מחירים ותיאורים. כמה שיותר תשובות נכונות לפני שהזמן נגמר.</p>
      ${b60 || b120 ? `<p class="counter">השיאים שלך: ${b60 ? `דקה <bdi>${Number(b60.score)}</bdi>` : ''}${b60 && b120 ? ' · ' : ''}${b120 ? `שתי דקות <bdi>${Number(b120.score)}</bdi>` : ''}</p>` : ''}
      <div class="clock-modes" role="group" aria-label="כמה זמן">
        ${CLOCK_MODES.map((m, k) => `<button class="btn${k ? ' btn-no' : ''} btn-wide" type="button" data-secs="${m.secs}">${esc(m.label)}</button>`).join('')}
      </div>
    </section>`);
  document.querySelectorAll('[data-secs]').forEach((b) => b.addEventListener('click', () => playClock(Number(b.dataset.secs))));
}

function playClock(secs) {
  const PRACTICE = 20;
  const deadline = secs ? Date.now() + secs * 1000 : 0;
  let pool = [];
  let score = 0;
  let answered = 0;
  let tick = null;
  let warned = false;
  let busy = false;
  const missed = [];
  const next = () => {
    if (!pool.length) pool = shuffle([...questionsWhat(), ...questionsPrice(), ...questionsWho()]);
    return pool.pop();
  };

  setPage('נגד השעון', `<h1 class="sr-only">נגד השעון</h1><div id="game"></div>`);
  document.body.classList.add('in-game');
  const box = document.getElementById('game');
  box.innerHTML = `
    <section class="flash wide">
      <p class="game-head">
        <a href="#/games"><span aria-hidden="true">→</span><span class="sr-only">חזרה למשחקים</span></a>
        <strong>נגד השעון</strong>
        ${secs ? '<span class="clock" role="timer" aria-live="off"><span aria-hidden="true">⏱</span> <span id="left"></span></span>' : `<span class="clock"><bdi id="left"></bdi></span>`}
        <span class="game-score"><span class="sr-only">נכונות </span><span id="score">0</span><span class="plus" id="plus" aria-hidden="true">+1</span></span>
      </p>
      ${secs ? `<div class="meter clock-meter" aria-hidden="true"><span class="meter-fill" id="bar"></span></div>` : ''}
      <div id="q"></div>
    </section>`;
  const left = document.getElementById('left');
  const bar = document.getElementById('bar');

  function update() {
    if (!document.body.contains(box)) { clearInterval(tick); return; }
    if (!secs) { left.textContent = `${answered}/${PRACTICE}`; return; }
    const ms = Math.max(0, deadline - Date.now());
    const s = Math.ceil(ms / 1000);
    left.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    bar.style.setProperty('width', `${(ms / (secs * 1000)) * 100}%`);
    if (s <= 10 && !warned) { warned = true; announce('נשארו 10 שניות'); box.querySelector('.clock').classList.add('low'); }
    if (ms <= 0) finish();
  }

  function ask() {
    const q = next();
    busy = false;
    document.getElementById('q').innerHTML = `
      <h2 class="sr-only" tabindex="-1" id="qh">שאלה ${answered + 1}${q.kind ? `: ${q.kind}` : ''}</h2>
      <div class="game-body q-in">
        <div>${q.prompt}</div>
        <div class="options" role="group" aria-label="תשובות">
          ${q.options.map((o, k) => `<button class="opt" type="button" data-k="${k}"><bdi>${esc(o)}</bdi></button>`).join('')}
        </div>
      </div>`;
    document.querySelectorAll('#q .opt').forEach((b) => b.addEventListener('click', () => choose(q, Number(b.dataset.k), b)));
    document.getElementById('qh').focus({ preventScroll: true });
  }

  function choose(q, k, btn) {
    if (busy) return;
    busy = true;
    const ok = k === q.correct;
    answered += 1;
    markResult(q.id, ok);
    if (!ok) missed.push(q.id);
    document.querySelectorAll('#q .opt').forEach((b) => {
      b.disabled = true;
      const n = Number(b.dataset.k);
      if (n === q.correct) { b.classList.add('right'); b.insertAdjacentText('afterbegin', '✓ '); }
      else if (n === k) { b.classList.add('wrong'); b.insertAdjacentText('afterbegin', '✗ '); }
    });
    if (ok) {
      score += 1;
      addXp(10, true);
      const sc = document.getElementById('score');
      sc.textContent = String(score);
      sc.parentElement.classList.remove('bump'); void sc.offsetWidth; sc.parentElement.classList.add('bump');
      burst(btn, 10);
    }
    announce(ok ? 'נכון' : `לא. ${q.options[q.correct]}`);
    update();
    const go = () => {
      clearTimeout(wait);
      if (!document.body.contains(box) || box.dataset.done) return;
      if (!secs && answered >= PRACTICE) return finish();
      ask();
    };
    let wait = null;
    if (secs) {
      // Against the clock, the next question comes by itself: that is the game.
      wait = setTimeout(go, ok ? 450 : 1100);
    } else {
      // Practice has no clock, so nothing moves on its own unless auto-advance is switched on.
      const opts = document.querySelector('#q .options');
      opts.insertAdjacentHTML('afterend', `
        <p class="verdict ${ok ? 'ok' : 'bad'}" id="verdict">${ok ? '✓ נכון' : `✗ זה ${nums(esc(q.options[q.correct]))}`}</p>
        <button class="btn btn-wide" id="next" type="button" aria-describedby="verdict">${answered >= PRACTICE ? 'לתוצאה' : 'הבא'}</button>`);
      const nb = document.getElementById('next');
      nb.addEventListener('click', go);
      nb.focus({ preventScroll: true });
      nb.scrollIntoView({ block: 'nearest' });
      if (ok && progress.autoNext && !prefersReducedMotion()) wait = setTimeout(go, 1600);
    }
  }

  function finish() {
    if (box.dataset.done) return;
    box.dataset.done = '1';
    clearInterval(tick);
    const key = `clock${secs}`;
    const prev = progress.best[key];
    const record = secs && score > 0 && (!prev || score > prev.score);
    if (record) { progress.best[key] = { score, of: Math.max(answered, 1) }; saveProgress(); }
    const newBest = record && prev;
    const right = score === 1 ? 'תשובה נכונה אחת' : `${score} תשובות נכונות`;
    box.innerHTML = `
      <section class="flash result q-in">
        <p class="result-big"><span id="sc">0</span></p>
        <h2 tabindex="-1" id="res" class="result-line">${secs ? `${right} ב${secs === 60 ? 'דקה' : 'שתי דקות'}` : `${score} מתוך ${answered}`}</h2>
        ${newBest ? '<p class="new-best">שיא חדש!</p>' : prev && secs ? `<p class="counter">השיא שלך: ${Number(prev.score)}</p>` : ''}
        ${missedHtml(missed)}
        <div class="two">
          <a class="btn btn-no" href="#/games">משחקים</a>
          <button class="btn btn-yes" type="button" id="again">עוד פעם</button>
        </div>
      </section>`;
    countUp(document.getElementById('sc'), score);
    if (newBest) setTimeout(shower, 300);
    document.getElementById('again').addEventListener('click', () => playClock(secs));
    window.scrollTo(0, 0);
    document.getElementById('res').focus({ preventScroll: true });
  }

  ask();
  update();
  tick = setInterval(update, 250);
}

export function viewGame(id) {
  if (id === 'clock') return viewClock();
  const daily = id === 'daily';
  const game = daily ? { id, name: 'האתגר היומי' } : GAMES.find((g) => g.id === id && g.ready);
  if (!game) return viewNotFound();
  const date = jerusalemDate();
  if (daily && progress.daily[date] != null) return viewDailyDone(date);
  const make = { what: questionsWhat, made: questionsMade, price: questionsPrice, who: questionsWho, customer: questionsCustomer, daily: questionsDaily }[id];
  let qs = make();
  let i = 0;
  let score = 0;
  let run = 0;
  let missed = [];
  let results = [];
  let timer = null;
  // Coming back to today's challenge picks up where it stopped; the same questions can't be retried.
  const resumed = daily && progress.dailyRun && progress.dailyRun.date === date ? progress.dailyRun.results : null;
  if (resumed) {
    results = resumed.slice(0, qs.length);
    i = results.length;
    score = results.filter(Boolean).length;
    missed = results.map((r, k) => (r ? null : qs[k].id)).filter(Boolean);
  }

  // Compact header so all four answers fit on a phone screen without scrolling.
  setPage(game.name, `
    <h1 class="sr-only">${esc(game.name)}</h1>
    <div id="game"></div>
  `);
  document.body.classList.add('in-game');
  const box = document.getElementById('game');
  // Any touch, key or scroll in the game means "I'm reading": cancel a pending auto-advance.
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchmove']) {
    box.addEventListener(ev, (e) => { if (!e.target.closest || !e.target.closest('.opt')) clearTimeout(timer); }, { passive: true });
  }

  const dots = () => `<ol class="dots" aria-hidden="true">${qs.map((_, k) =>
    `<li class="${results[k] === true ? 'ok' : results[k] === false ? 'bad' : k === i ? 'now' : ''}"></li>`).join('')}</ol>`;

  function ask() {
    clearTimeout(timer);
    if (i >= qs.length) return end();
    const q = qs[i];
    box.innerHTML = `
      <section class="flash${id === 'what' || id === 'price' ? ' wide' : ''} q-in">
        <h2 class="sr-only" tabindex="-1" id="qh">שאלה ${i + 1} מתוך ${qs.length}, ניקוד ${score}${q.kind ? `: ${q.kind}` : ''}</h2>
        <p class="game-head">
          <a href="${daily ? '#/' : '#/games'}"><span aria-hidden="true">→</span><span class="sr-only">${daily ? 'לדף הבית' : 'חזרה למשחקים'}</span></a>
          <strong>${esc(game.name)}</strong>
          ${run >= 3 ? `<span class="chip-streak"><span aria-hidden="true">🔥</span> ${run} ברצף</span>` : ''}
          <span class="game-score"><span class="sr-only">ניקוד </span><span id="score">${score}</span><span class="plus" id="plus" aria-hidden="true">+1</span></span>
        </p>
        ${dots()}
        <div class="game-body">
          <div>${q.prompt}</div>
          <div>
            <div class="options" role="group" aria-label="תשובות">
              ${q.options.map((o, k) => `<button class="opt" type="button" data-k="${k}"><bdi>${esc(o)}</bdi></button>`).join('')}
            </div>
            <div id="feedback"></div>
            <label class="auto-toggle">
              <input type="checkbox" id="auto"${progress.autoNext ? ' checked' : ''}>
              מעבר אוטומטי אחרי תשובה נכונה
            </label>
          </div>
        </div>
      </section>`;
    document.getElementById('auto').addEventListener('change', (e) => {
      progress.autoNext = e.target.checked;
      saveProgress();
      if (!e.target.checked) clearTimeout(timer);
    });
    box.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.k), b)));
  }

  function choose(k, btn) {
    const q = qs[i];
    const ok = k === q.correct;
    results[i] = ok;
    if (daily) { progress.dailyRun = { date, results: results.slice(0, i + 1) }; saveProgress(); }
    if (ok) { score += 1; run += 1; addXp(10, true); } else { run = 0; missed.push(q.id); box.querySelector('.chip-streak')?.remove(); }
    markResult(q.id, ok);
    box.querySelectorAll('.opt').forEach((b) => {
      const n = Number(b.dataset.k);
      b.disabled = true;
      if (n === q.correct) { b.classList.add('right'); b.insertAdjacentText('afterbegin', '✓ '); }
      else if (n === k) { b.classList.add('wrong'); b.insertAdjacentText('afterbegin', '✗ '); }
    });
    box.querySelector('.dots').outerHTML = dots();
    if (ok) {
      const s = document.getElementById('score');
      s.textContent = String(score);
      s.parentElement.classList.remove('bump'); void s.offsetWidth; s.parentElement.classList.add('bump');
      document.getElementById('plus').classList.add('go');
      burst(btn, run >= 3 ? 30 : 16);
    }
    const line = ok
      ? (STREAK_PRAISE[run] || PRAISE[Math.floor(Math.random() * PRAISE.length)])
      : `כמעט! זה ${q.options[q.correct]}`;
    const last = i + 1 >= qs.length;
    document.getElementById('feedback').innerHTML = `
      <p class="verdict ${ok ? 'ok' : 'bad'}" id="verdict">${ok ? '✓' : '✗'} ${nums(esc(line))}</p>
      <p class="explain">${esc(q.explain)}</p>
      <button class="btn btn-wide" id="next" type="button" aria-describedby="verdict">${last ? 'לתוצאה' : 'הבא'}</button>`;
    announce(ok ? `נכון. ${line}` : `לא נכון. התשובה: ${q.options[q.correct]}`);
    const go = () => {
      clearTimeout(timer); i += 1; ask();
      window.scrollTo(0, 0);
      document.getElementById('qh')?.focus({ preventScroll: true });
    };
    const next = document.getElementById('next');
    next.addEventListener('click', go);
    next.focus({ preventScroll: true });
    // Make sure the verdict and "next" are on screen (phones: under the answers).
    document.getElementById('feedback').scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    // After a right answer the game moves on by itself; after a mistake it waits, so you can read.
    if (ok && progress.autoNext && !prefersReducedMotion()) {
      timer = setTimeout(() => { if (document.getElementById('next') === next) go(); }, 1600);
    }
  }

  function end() {
    if (daily) return endDaily();
    syncTotal(progress.gameXp || 0).catch(() => {});
    const prev = progress.best[id];
    const record = !prev || score / qs.length > prev.score / prev.of;
    if (record) { progress.best[id] = { score, of: qs.length }; saveProgress(); }
    const newBest = record && prev;
    const pct = Math.round((score / qs.length) * 100);
    const review = missedHtml(missed);
    const line = score === qs.length ? 'מושלם! שף קונדיטור אמיתי'
      : score >= 8 ? 'מעולה!' : score >= 5 ? 'יפה, כמעט שם' : 'כדאי לעבור על הכרטיסיות ולנסות שוב';
    box.innerHTML = `
      <section class="flash result q-in">
        ${ring(pct, 150, 64, `<span id="sc">0</span>/${qs.length}`)}
        <h2 tabindex="-1" id="res" class="result-line">${newBest ? 'שיא חדש! ' : ''}${esc(line)}</h2>
        <p class="sr-only">${score} מתוך ${qs.length}</p>
        <p><span class="xp-gain">+${score * 10} נקודות</span> · ${esc(levelInfo().name)}</p>
        ${review}
        <div class="two">
          <a class="btn btn-no" href="#/games">משחקים</a>
          <button class="btn btn-yes" id="again" type="button">עוד סיבוב</button>
        </div>
      </section>`;
    fillMeters(box);
    countUp(document.getElementById('sc'), score);
    if (score >= 8 || newBest) setTimeout(shower, 300);
    window.scrollTo(0, 0);
    document.getElementById('res').focus({ preventScroll: true });
    document.getElementById('again').addEventListener('click', () => {
      qs = make(); i = 0; score = 0; run = 0; missed = []; results = []; ask();
    });
  }

  function endDaily() {
    progress.daily[date] = score;
    progress.dailyRun = null;
    saveProgress();
    const pct = Math.round((score / qs.length) * 100);
    const named = cloudEnabled() && myPlayer();
    box.innerHTML = `
      <section class="flash result q-in">
        ${ring(pct, 150, 64, `<span id="sc">0</span>/${qs.length}`)}
        <h2 tabindex="-1" id="res" class="result-line">${score >= 8 ? 'אליפות של היום!' : score >= 5 ? 'יפה מאוד!' : 'מחר יש עוד הזדמנות'}</h2>
        <p class="sr-only">${score} מתוך ${qs.length}</p>
        <p id="daily-status" role="status">${named ? 'שולח לטבלת הצוות…' : cloudEnabled() ? 'רוצים להופיע בטבלת הצוות? אפשר לבחור כינוי בעמוד הצוות.' : 'התוצאה נשמרה בטלפון.'}</p>
        <div class="two">
          <a class="btn btn-no" href="#/">לדף הבית</a>
          ${cloudEnabled() ? '<a class="btn btn-yes" href="#/team">לטבלת הצוות</a>' : '<a class="btn btn-yes" href="#/games">עוד משחקים</a>'}
        </div>
      </section>`;
    fillMeters(box);
    countUp(document.getElementById('sc'), score);
    if (score >= 8) setTimeout(shower, 300);
    window.scrollTo(0, 0);
    document.getElementById('res').focus({ preventScroll: true });
    if (named) {
      Promise.all([submitDaily(date, score), syncTotal(progress.gameXp || 0)])
        .then(() => { document.getElementById('daily-status').textContent = 'התוצאה נכנסה לטבלת הצוות.'; })
        .catch(() => { document.getElementById('daily-status').textContent = 'לא הצלחנו לשלוח לטבלה. התוצאה נשמרה בטלפון.'; });
    }
  }

  if (resumed && i < qs.length) announce(`ממשיכים מהשאלה ${i + 1}`);
  ask();
}

function viewDailyDone(date) {
  setPage('האתגר היומי', `
    <section class="flash result">
      ${ring(progress.daily[date] * 10, 150, 64, `${progress.daily[date]}/10`)}
      <h1 class="result-line">כבר עשית את האתגר של היום</h1>
      <p>אתגר חדש מחכה מחר בבוקר. בינתיים אפשר לשחק בשאר המשחקים.</p>
      <div class="two">
        <a class="btn btn-no" href="#/">לדף הבית</a>
        ${cloudEnabled() ? '<a class="btn btn-yes" href="#/team">לטבלת הצוות</a>' : '<a class="btn btn-yes" href="#/games">משחקים</a>'}
      </div>
    </section>`);
}
