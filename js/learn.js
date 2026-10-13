/* Learning: flashcards and games. */

import { db, announce, esc, norm, priceLabel, imgSrc, imgHtml, family, setPage, catIcon, meter, fillMeters, prefersReducedMotion } from './core.js';
import { progress, saveProgress, markResult, setKnown, knownCount, addXp, levelInfo } from './progress.js';
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
      <span class="level-name">מכיר/ה ${done} מתוך ${total}</span>
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
    const bare = !p.image && !(p.ingredients || []).length;
    const catName = (db.categories.find((c) => c.id === p.category) || {}).name || '';
    box.innerHTML = `
      <div class="flip q-in" id="card">
        <div class="flip-inner">
          <section class="face face-front" aria-label="צד קדמי">
            <p class="counter">כרטיס ${seen + 1} · מכיר/ה ${knownCount(items)}/${items.length}</p>
            ${bare
              ? `<p class="flash-name">${esc(p.name)}</p><p class="counter">${esc(catName)}</p>
                 <p class="flash-q" tabindex="-1" id="fq">כמה זה עולה?</p>`
              : `${clueHtml(p)}
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
        <p>את/ה מכיר/ה ${k} מתוך ${items.length} מוצרים כאן.</p>
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
  { id: 'customer', name: 'שאלת לקוח', desc: 'שאלות אמיתיות מהדלפק.', ready: false },
  { id: 'clock', name: 'נגד השעון', desc: 'כמה שיותר תשובות בדקה.', ready: false }
];

export function viewGames() {
  const lvl = levelInfo();
  const items = GAMES.map((g) => {
    const best = progress.best[g.id];
    return g.ready
      ? `<li class="rise"><a class="row-link" href="#/game/${g.id}">
           ${gameIcon(g.id)}
           <span class="row-title">${esc(g.name)}</span>
           ${best ? `<span class="soon">שיא ${Number(best.score)}/${Number(best.of)}</span>` : '<span></span>'}
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
    <h2>בחר/י משחק</h2>
    <ul class="rows">${items}</ul>
  `);
}

const PRAISE = ['בול!', 'יש לך עין של קונדיטור', 'נכון!', 'מקצוען/ית', 'בדיוק ככה', 'יפה מאוד!'];
const STREAK_PRAISE = { 3: 'שלוש ברצף!', 5: 'חמש ברצף! 🔥', 8: 'שמונה ברצף! מי עוצר אותך?' };

const ROUND = 10;

function questionsWhat(order = weightedOrder) {
  const showable = db.products.filter((p) => p.image && hintText(p));
  const pool = order(showable).slice(0, ROUND);
  return pool.map((p) => {
    // Distractors never share the answer's name (some names repeat across categories).
    const names = new Set([norm(p.name)]);
    const wrong = [];
    const fam = db.products.filter((o) => family(o) === family(p));
    for (const o of [...shuffle(db.byCat.get(p.category)), ...shuffle(fam), ...shuffle(db.products)]) {
      if (wrong.length === 3) break;
      if (names.has(norm(o.name))) continue;
      names.add(norm(o.name));
      wrong.push(o);
    }
    const options = shuffle([p, ...wrong]).map((o) => o.name);
    return {
      id: p.id,
      prompt: clueHtml(p),
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

// 10 questions, identical for the whole team on a given day: a mix of all four games.
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

export function viewGame(id) {
  const daily = id === 'daily';
  const game = daily ? { id, name: 'האתגר היומי' } : GAMES.find((g) => g.id === id && g.ready);
  if (!game) return viewNotFound();
  const date = jerusalemDate();
  if (daily && progress.daily[date] != null) return viewDailyDone(date);
  const make = { what: questionsWhat, made: questionsMade, price: questionsPrice, who: questionsWho, daily: questionsDaily }[id];
  let qs = make();
  let i = 0;
  let score = 0;
  let run = 0;
  let missed = [];
  let results = [];
  let timer = null;

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
        <h2 class="sr-only" tabindex="-1" id="qh">שאלה ${i + 1} מתוך ${qs.length}, ניקוד ${score}${id === 'what' ? ': מה זה?' : ''}</h2>
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
      <p class="verdict ${ok ? 'ok' : 'bad'}" id="verdict">${ok ? '✓' : '✗'} ${esc(line)}</p>
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
    const review = missed.length
      ? `<h3>כדאי לחזור על</h3>
         <ul class="missed">${[...new Set(missed)].map((pid) => db.byId.get(pid)).filter(Boolean).map((p) => `
           <li><a href="#/p/${encodeURIComponent(p.id)}">${imgHtml(p, 'mini', 120, '')}<span>${esc(p.name)}</span></a></li>`).join('')}
         </ul>`
      : '';
    const line = score === qs.length ? 'מושלם! שף קונדיטור אמיתי'
      : score >= 8 ? 'מעולה!' : score >= 5 ? 'יפה, עוד קצת ואת/ה שם' : 'כדאי לעבור על הכרטיסיות ולנסות שוב';
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
    saveProgress();
    const pct = Math.round((score / qs.length) * 100);
    const named = cloudEnabled() && myPlayer();
    box.innerHTML = `
      <section class="flash result q-in">
        ${ring(pct, 150, 64, `<span id="sc">0</span>/${qs.length}`)}
        <h2 tabindex="-1" id="res" class="result-line">${score >= 8 ? 'אלופ/ה של היום!' : score >= 5 ? 'יפה מאוד!' : 'מחר יש עוד הזדמנות'}</h2>
        <p class="sr-only">${score} מתוך ${qs.length}</p>
        <p id="daily-status" role="status">${named ? 'שולח לטבלת הצוות…' : cloudEnabled() ? 'רוצה להופיע בטבלת הצוות? בחר/י כינוי בעמוד הצוות.' : 'התוצאה נשמרה בטלפון.'}</p>
        <div class="two">
          <a class="btn btn-no" href="#/">לדף הבית</a>
          <a class="btn btn-yes" href="#/team">לטבלת הצוות</a>
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

  ask();
}

function viewDailyDone(date) {
  setPage('האתגר היומי', `
    <section class="flash result">
      ${ring(progress.daily[date] * 10, 150, 64, `${progress.daily[date]}/10`)}
      <h1 class="result-line">כבר עשית את האתגר של היום</h1>
      <p>אתגר חדש מחכה מחר בבוקר. בינתיים אפשר לשחק בשאר המשחקים.</p>
      <div class="two">
        <a class="btn btn-no" href="#/games">משחקים</a>
        <a class="btn btn-yes" href="#/team">לטבלת הצוות</a>
      </div>
    </section>`);
}
