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
    <p>רואים את המוצר, נזכרים בשם, והופכים את הכרטיס. מה שעוד לא ידוע חוזר לעתים קרובות יותר.</p>
    <div class="level">
      ${ring(total ? Math.round((done / total) * 100) : 0, 64, 27, `${total ? Math.round((done / total) * 100) : 0}%`)}
      <span class="level-name">מוכרים: ${done} מתוך ${total}</span>
      <span class="level-sub">כל מוצר שסימנת שווה 5 נקודות</span>
      <span><a class="btn" href="#/learn/all">לכל המוצרים</a></span>
    </div>
    <a class="row-link onboard-cta" href="#/onboard">
      <span class="row-title">שבוע ראשון</span>
      <span class="soon">מסלול הכניסה לצוות</span>
      <span class="row-sub full">קטגוריה או שתיים בכל יום: כרטיסיות, מבחן קצר, ובסוף תעודה.</span>
    </a>
    <h2>לפי קטגוריה</h2>
    <ul class="rows">${rows}</ul>
  `);
}

/* ---------- flashcards ---------- */

// opts (used by the onboarding path): { items, title, back: {href, label}, onFinish, next: {href, label} }
export function viewFlashcards(catId, opts = null) {
  const items = opts ? opts.items : catId === 'all' ? db.products : db.byCat.get(catId);
  const cat = db.categories.find((c) => c.id === catId);
  if (!items || !items.length) return viewNotFound();
  const title = opts ? opts.title : cat ? cat.name : 'כל המוצרים';
  const back = opts ? opts.back : { href: '#/learn', label: 'כרטיסיות' };
  let deck = weightedOrder(items);
  let pos = 0;
  let seen = 0;
  let knewInRow = 0;

  setPage(`כרטיסיות: ${title}`, `
    <a class="back" href="${back.href}"><span aria-hidden="true">→</span> ${esc(back.label)}</a>
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
            <button class="btn btn-wide" id="flip" type="button">להפוך</button>
          </section>
          <section class="face face-back" aria-label="התשובה" hidden>
            ${imgHtml(p, 'quiz-img', 600, '')}
            <h2 class="flash-name" tabindex="-1" id="ans">${esc(p.name)}</h2>
            <p class="price"><bdi>${esc(priceLabel(p))}</bdi></p>
            ${(p.staff_description || p.description) ? `<p>${esc(p.staff_description || p.description)}</p>` : ''}
            ${p.sales && p.sales.pitch ? `<p class="fc-pitch">${p.sales.draft ? '<span class="draft-badge">טיוטה</span> ' : ''}<b>איך מציעים:</b> ${esc(p.sales.pitch)}</p>` : ''}
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
    if (opts && opts.onFinish) opts.onFinish();
    const k = knownCount(items);
    box.innerHTML = `
      <section class="flash result q-in">
        ${ring(Math.round((k / items.length) * 100), 150, 64, `<span id="pct">0</span>%`)}
        <h2 tabindex="-1" id="done">סיימת את הסבב</h2>
        <p>מוכרים לך ${k} מתוך ${items.length} מוצרים כאן.</p>
        <div class="two">
          <button class="btn btn-no" id="again" type="button">עוד סיבוב</button>
          ${opts && opts.next ? `<a class="btn btn-yes" href="${opts.next.href}">${esc(opts.next.label)}</a>` : ''}
        </div>
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
  { id: 'made', name: 'ממה זה עשוי?', desc: 'רואים שם של מוצר ובוחרים מה יש בו.', ready: true },
  { id: 'price', name: 'כמה זה עולה?', desc: 'רואים מוצר ובוחרים את המחיר הנכון.', ready: true },
  { id: 'who', name: 'איזה מוצר?', desc: 'קוראים תיאור ומזהים את המוצר.', ready: true },
  { id: 'customer', name: 'שאלת לקוח', desc: 'שאלות אמיתיות מהדלפק: נסיעה, שמירה, אירוח.', ready: true },
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
      ${ring(lvl.pct, 64, 27, `${lvl.pct}%`)}
      <span class="level-name">${esc(lvl.name)} · ${lvl.points} נקודות</span>
      <span class="level-sub">${lvl.next ? `עוד ${lvl.toNext} נקודות ל${esc(lvl.next)}` : 'הדרגה הגבוהה ביותר'}</span>
      <span class="level-sub">כל תשובה נכונה: 10 נקודות</span>
    </div>
    <h2>איזה משחק?</h2>
    <ul class="rows">${items}</ul>
    ${badgesHtml()}
    <details class="settings">
      <summary>הגדרות משחק</summary>
      <label class="toggle-row">
        <input type="checkbox" id="auto"${progress.autoNext ? ' checked' : ''}>
        מעבר אוטומטי לשאלה הבאה אחרי תשובה נכונה
      </label>
    </details>
  `);
  document.getElementById('auto').addEventListener('change', (e) => {
    progress.autoNext = e.target.checked;
    saveProgress();
    announce(e.target.checked ? 'מעבר אוטומטי פועל' : 'מעבר אוטומטי כבוי');
  });
}

/* ---------- badges: earned from personal progress, kept on this phone ---------- */

const perfect = (id) => { const b = progress.best[id]; return Boolean(b && b.score >= ROUND && b.of >= ROUND); };

function badges() {
  const list = [
    { icon: 'croissant', name: 'כתר הקרואסונים', how: 'מכירים את כל המאפים', got: () => (db.byCat.get('pastries') || []).every((p) => progress.known[p.id]) },
    { icon: 'tag', name: 'מחירון מהלך', how: '10 מתוך 10 ב"כמה זה עולה?"', got: () => perfect('price') },
    { icon: 'eye', name: 'עין של קונדיטור', how: '10 מתוך 10 ב"מה זה?"', got: () => perfect('what') },
    { icon: 'list', name: 'קריאת מתכונים', how: '10 מתוך 10 ב"ממה זה עשוי?"', got: () => perfect('made') },
    { icon: 'search', name: 'עין של בלש', how: '10 מתוך 10 ב"מי המוצר?"', got: () => perfect('who') },
    { icon: 'bell', name: 'שירות מושלם', how: '10 מתוך 10 ב"שאלת לקוח"', got: () => perfect('customer') },
    { icon: 'bolt', name: 'ידיים מהירות', how: '15 נכונות בדקה ב"נגד השעון"', got: () => (progress.best.clock60 || {}).score >= 15 },
    { icon: 'medal', name: 'אליפות היום', how: '10 מתוך 10 באתגר היומי', got: () => Object.values(progress.daily).some((v) => v >= ROUND) },
    { icon: 'flame', name: 'שבוע ברצף', how: 'לומדים 7 ימים ברצף', got: () => streak() >= 7 },
    { icon: 'cap', name: 'כל הוויטרינה בראש', how: 'כל המוצרים מסומנים "מוכר לי"', got: () => db.products.every((p) => progress.known[p.id]) }
  ];
  return list.map((b) => ({ ...b, got: b.got() }));
}

// Line icons from the same family as the navigation.
const BADGE_ICONS = {
  croissant: '<path d="M3 15c2-6 6-9 9-9s7 3 9 9c-2 1.5-5 2.5-9 2.5S5 16.5 3 15z"/><path d="M8.5 8.5l1.5 8.5M15.5 8.5l-1.5 8.5M12 6.2v11"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  list: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>',
  bell: '<path d="M4 17h16"/><path d="M6 17a6 6 0 0 1 12 0"/><path d="M12 8V6M10 6h4"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M8 3l2.5 7.5M16 3l-2.5 7.5"/>',
  flame: '<path d="M12 21c-4 0-6-2.5-6-6 0-4 4-6 4-10 3 2 8 6 8 10 0 3.5-2 6-6 6z"/><path d="M12 21c-1.7 0-2.5-1.2-2.5-2.7 0-1.8 2.5-3.3 2.5-3.3s2.5 1.5 2.5 3.3c0 1.5-.8 2.7-2.5 2.7z"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>'
};

function badgesHtml() {
  const all = badges();
  const n = all.filter((b) => b.got).length;
  return `
    <h2>תגים <span class="counter">(${n} מתוך ${all.length})</span></h2>
    <ul class="badges">${all.map((b) => `
      <li class="badge${b.got ? ' got' : ''}">
        <span class="badge-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${BADGE_ICONS[b.icon]}</svg></span>
        <span class="badge-name">${esc(b.name)}</span>
        ${b.got ? '<span class="badge-got">✓ הושג</span>' : ''}
        <span class="badge-how">${b.got ? '' : '<span class="sr-only">עוד לא. </span>'}${esc(b.how)}</span>
      </li>`).join('')}
    </ul>`;
}

const PRAISE = ['בול', 'נכון', 'בדיוק ככה', 'יפה מאוד', 'עין של קונדיטור'];
const STREAK_PRAISE = { 3: 'שלוש ברצף', 5: 'חמש ברצף', 8: 'שמונה ברצף. מי עוצר אותך?' };

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
export { jerusalemDate } from './core.js';
import { jerusalemDate } from './core.js';

/* "שאלת לקוח": counter questions from the customer FAQ, plus prices asked the way a customer asks.
   No pregnancy or kashrut answers: those go to the shift manager, and the game teaches exactly that. */

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
  const qs = [
    {
      id: 'faq:travel',
      prompt: bubble('זה יחזיק נסיעה של שעה באוטו?', 'לקוח שואל'),
      ...choices(['בלי בעיה, גם שלוש שעות', 'חצי שעה בטוח, שעה זה גבולי', 'רק אם זה במקרר', 'לא, צריך לאכול מיד'], 1),
      explain: 'מחזיק נסיעה של חצי שעה באוטו. שעה זה גבולי.'
    },
    {
      id: 'faq:freeze',
      prompt: bubble('אני קונה היום לאירוע בעוד כמה ימים. איך שומרים?', 'לקוחה שואלת'),
      ...choices(['לשמור במקפיא ולהוציא שעה לפני', 'לשמור במקרר עד האירוע', 'לא כדאי, רק לקנות ביום עצמו', 'לחמם בתנור לפני ההגשה'], 0),
      explain: 'הכול קפוא. אפשר לשמור כמה ימים במקפיא ולהוציא שעה לפני שאוכלים.'
    },
    {
      id: 'faq:pregnant',
      prompt: bubble('אני בהריון. מה מתאים לי?', 'לקוחה שואלת'),
      ...choices(['אפשר להראות לך את הרכיבים של כל מוצר. לשאלה רפואית כדאי להתייעץ עם רופא.', 'בטח, הכול כאן מפוסטר ובטוח לגמרי, אפשר לבחור כל מה שבא לך', 'רק המאפים המלוחים', 'שום דבר עם גבינה'], 0),
      explain: 'לא נותנים המלצות רפואיות. מראים רכיבים ומפנים לרופא.'
    },
    {
      id: 'faq:allergy',
      prompt: bubble('יש בזה אגוזים? יש לי אלרגיה.', 'לקוח שואל'),
      ...choices(['אין לנו מידע מלא על אלרגנים. אבדוק עם אחראי המשמרת.', 'לא, אין בזה אגוזים בכלל. אפשר להיות רגועים לגמרי', 'רק בפיסטוק', 'זה בסדר, רק טיפה'], 0),
      explain: 'באתר אין מידע על אלרגנים. על אלרגיה תמיד בודקים עם אחראי המשמרת.'
    }
  ];
  // Counter facts from the sales coach. Names and prices come from the data, so a question drops out
  // (instead of going stale) when a product leaves the menu.
  const find = (name, cat) => db.products.find((p) => norm(p.name) === norm(name) && (!cat || p.category === cat));
  const shek = (p) => `${basePrice(p)} ₪`;
  const truffle = find('טראפלס');
  const madeleine = find('עוגיית מדלן');
  if (truffle && madeleine && basePrice(truffle) != null && basePrice(madeleine) != null) {
    qs.push({
      id: 'faq:addon',
      prompt: bubble('לקחתי קרואסון. יש משהו קטן ליד?', 'לקוח שואל'),
      ...choices([`${truffle.name} או ${madeleine.name}, ${shek(truffle)}`, 'מארז מקרונים', 'קערת טירמיסו', 'לחם שלם'], 0),
      explain: `משהו קטן ליד הקפה: ${truffle.name} (${shek(truffle)}) או ${madeleine.name} (${shek(madeleine)}).`
    });
  }
  const mousseOne = find('מוס שוקולד', 'patisserie');
  const mousseBar = find('מוס שוקולד', 'cakes');
  if (mousseOne && mousseBar && basePrice(mousseOne) != null && basePrice(mousseBar) != null) {
    qs.push({
      id: 'faq:mousse',
      prompt: bubble('ראיתי שני מוס שוקולד. מה ההבדל?', 'לקוחה שואלת'),
      ...choices([`אחד אישי (${shek(mousseOne)}), ואחד בפס לשולחן (${shek(mousseBar)})`, 'זה אותו דבר', 'אחד עם שוקולד לבן', 'אחד קפוא ואחד טרי'], 0),
      explain: `מוס שוקולד אישי ${shek(mousseOne)}, מוס שוקולד בפס לשולחן ${shek(mousseBar)}.`
    });
  }
  qs.push({
    id: 'faq:hosting',
    prompt: bubble('אני מארחת שמונה אנשים מחר בערב. מה כדאי?', 'לקוחה שואלת'),
    ...choices(['עוגה שלמה או קערה. לשמור במקפיא ולהוציא שעה לפני', 'מנה אישית לכל אחד', 'לקנות רק ביום עצמו', 'לחמם בתנור לפני ההגשה'], 0),
    explain: 'לאירוח: עוגה שלמה או קערה. הכול קפוא, אז שומרים במקפיא ומוציאים שעה לפני.'
  });
  const egg = find('ביצת פברז’ה') || find('ביצת פברז׳ה');
  const macarons = find('מארז מקרונים');
  if (egg && macarons) {
    qs.push({
      id: 'faq:gift',
      prompt: bubble('אני מחפש מתנה קטנה, משהו יפה.', 'לקוח שואל'),
      ...choices([`${egg.name} או ${macarons.name}`, 'כריך כמהין', 'לחם אגוזים', 'מיץ תפוזים'], 0),
      explain: `למתנה: ${egg.name} או ${macarons.name}.`
    });
  }
  // The rest: "how much is it?" at the counter, with the photo as a hint.
  for (const q of questionsPrice(order).slice(0, ROUND - qs.length)) {
    const p = db.byId.get(q.id);
    const size = (p.sizes || []).length ? ` (${p.sizes[0].label})` : '';
    qs.push({ ...q, prompt: bubble(`כמה עולה <strong>${esc(p.name)}</strong>${esc(size)}?`, 'לקוח שואל', p) });
  }
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
        <span class="game-score">נכונות <span id="score">0</span><span class="plus" id="plus" aria-hidden="true">+1</span></span>
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
    announce(ok ? 'נכון' : `לא נכון. התשובה: ${q.options[q.correct]}`);
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
        <p class="verdict ${ok ? 'ok' : 'bad'}" id="verdict">${ok ? '✓ נכון' : `✗ לא נכון. התשובה: ${nums(esc(q.options[q.correct]))}`}</p>
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
        ${newBest ? '<p class="new-best">שיא חדש</p>' : prev && secs ? `<p class="counter">השיא שלך: ${Number(prev.score)}</p>` : ''}
        ${missedHtml(missed)}
        <div class="two">
          <a class="btn btn-no" href="#/games">משחקים</a>
          <button class="btn btn-yes" type="button" id="again">עוד סבב</button>
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

// custom (used by the onboarding path): { name, make, back, xp (false: no points), onEnd({score, of, missed, box}) }
export function viewGame(id, custom = null) {
  if (id === 'clock' && !custom) return viewClock();
  const daily = id === 'daily' && !custom;
  const game = custom ? { id, name: custom.name } : daily ? { id, name: 'האתגר היומי' } : GAMES.find((g) => g.id === id && g.ready);
  if (!game) return viewNotFound();
  const date = jerusalemDate();
  if (daily && progress.daily[date] != null) return viewDailyDone(date);
  const make = custom ? custom.make : { what: questionsWhat, made: questionsMade, price: questionsPrice, who: questionsWho, customer: questionsCustomer, daily: questionsDaily }[id];
  let qs = make();
  if (!qs.length) return viewNotFound();
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
          <a href="${custom ? custom.back : daily ? '#/' : '#/games'}"><span aria-hidden="true">→</span><span class="sr-only">${custom ? 'חזרה' : daily ? 'לדף הבית' : 'חזרה למשחקים'}</span></a>
          <strong>${esc(game.name)}</strong>
          ${run >= 3 ? `<span class="chip-streak"><span aria-hidden="true">🔥</span> ${run} ברצף</span>` : ''}
          <span class="game-score">ניקוד <span id="score">${score}</span><span class="plus" id="plus" aria-hidden="true">+1</span></span>
        </p>
        ${dots()}
        <div class="game-body">
          <div>${q.prompt}</div>
          <div>
            <div class="options" role="group" aria-label="תשובות">
              ${q.options.map((o, k) => `<button class="opt" type="button" data-k="${k}"><bdi>${esc(o)}</bdi></button>`).join('')}
            </div>
            <div id="feedback"></div>
          </div>
        </div>
      </section>`;
    box.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.k), b)));
  }

  function choose(k, btn) {
    const q = qs[i];
    const ok = k === q.correct;
    results[i] = ok;
    if (daily) { progress.dailyRun = { date, results: results.slice(0, i + 1) }; saveProgress(); }
    if (ok) { score += 1; run += 1; if (!custom || custom.xp !== false) addXp(10, true); } else { run = 0; missed.push(q.id); box.querySelector('.chip-streak')?.remove(); }
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
      : `לא נכון. התשובה: ${q.options[q.correct]}`;
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
    if (custom) {
      syncTotal(progress.gameXp || 0).catch(() => {});
      custom.onEnd({ score, of: qs.length, missed: [...missed], box, review: missedHtml(missed) });
      window.scrollTo(0, 0);
      document.getElementById('res')?.focus({ preventScroll: true });
      return;
    }
    if (daily) return endDaily();
    syncTotal(progress.gameXp || 0).catch(() => {});
    const prev = progress.best[id];
    const record = !prev || score / qs.length > prev.score / prev.of;
    if (record) { progress.best[id] = { score, of: qs.length }; saveProgress(); }
    const newBest = record && prev;
    const pct = Math.round((score / qs.length) * 100);
    const review = missedHtml(missed);
    const line = score === qs.length ? 'מושלם. כל התשובות נכונות'
      : score >= 8 ? 'מעולה' : score >= 5 ? 'יפה. עוד קצת תרגול' : 'כדאי לעבור על הכרטיסיות ולנסות שוב';
    box.innerHTML = `
      <section class="flash result q-in">
        ${ring(pct, 150, 64, `<span id="sc">0</span>/${qs.length}`)}
        <h2 tabindex="-1" id="res" class="result-line">${newBest ? 'שיא חדש. ' : ''}${esc(line)}</h2>
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
        <h2 tabindex="-1" id="res" class="result-line">${score === 10 ? 'מושלם' : score >= 8 ? 'כמעט מושלם' : score >= 5 ? 'יפה מאוד' : 'מחר יש עוד הזדמנות'}</h2>
        <p class="sr-only">${score} מתוך ${qs.length}</p>
        <p id="daily-status" role="status">${named ? 'התוצאה נשלחת לטבלת הצוות…' : cloudEnabled() ? 'רוצים להופיע בטבלת הצוות? אפשר לבחור כינוי בעמוד הצוות.' : 'התוצאה נשמרה בטלפון.'}</p>
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
      <p>מחר יש אתגר חדש. בינתיים אפשר לשחק בשאר המשחקים.</p>
      <div class="two">
        <a class="btn btn-no" href="#/">לדף הבית</a>
        ${cloudEnabled() ? '<a class="btn btn-yes" href="#/team">לטבלת הצוות</a>' : '<a class="btn btn-yes" href="#/games">משחקים</a>'}
      </div>
    </section>`);
}

/* ---------- question sets for a fixed list of products (onboarding) ---------- */

// A mixed quiz over just these products: photo, ingredients, price and description questions,
// one per product first, then a second kind of question where the list is short.
export function questionsFor(items, n) {
  const ids = new Set(items.map((p) => p.id));
  const only = (list) => shuffle(list.filter((p) => ids.has(p.id)));
  const pools = shuffle([questionsWhat(only), questionsMade(only), questionsPrice(only), questionsWho(only)]);
  const out = [];
  const used = new Set();
  for (let pass = 0; pass < 2 && out.length < n; pass++) {
    for (const pool of pools) {
      for (const q of pool) {
        if (out.length >= n) break;
        const key = pass === 0 ? q.id : `${q.id}|${q.prompt}`;
        if (used.has(key) || (pass === 0 && out.some((o) => o.id === q.id))) continue;
        if (pass === 1 && out.some((o) => o.id === q.id && o.prompt === q.prompt)) continue;
        used.add(key);
        out.push(q);
      }
    }
  }
  return shuffle(out);
}
