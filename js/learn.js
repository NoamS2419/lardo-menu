/* Learning: flashcards and games. */

import { db, announce, esc, norm, priceLabel, imgSrc, imgHtml, family, setPage } from './core.js';
import { progress, saveProgress, markResult, setKnown, knownCount, progressBar } from './progress.js';
import { viewNotFound } from './catalog.js';

/* ---------- random helpers ---------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Items the employee misses more, or hasn't marked as known, come up first.
function weightedOrder(items) {
  return items
    .map((p) => ({ p, w: (progress.known[p.id] ? 0 : 2) + (progress.miss[p.id] || 0) * 2 + Math.random() * 2.5 }))
    .sort((a, b) => b.w - a.w)
    .map((x) => x.p);
}

const pick = (arr, n) => shuffle(arr).slice(0, n);

/* ---------- product "clue" when there is no photo yet ---------- */

// Description with the product's own name and aliases blanked out, for screen-reader users
// who can't see the photo. Empty when there is nothing safe to say.
export function hintText(p) {
  let text = [p.staff_description, p.description].find((t) => t) || (p.ingredients || []).join(', ');
  for (const n of [p.name, ...(p.aliases || [])]) {
    for (const w of String(n).split(/\s+/).filter((x) => x.length > 2)) text = text.split(w).join('…');
  }
  return text.replace(/(…\s*)+/g, '… ').trim();
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
      <li>
        <a class="row-link" href="#/learn/${encodeURIComponent(c.id)}">
          <span class="row-title">${esc(c.name)}</span>
          <span class="row-sub">${k}/${items.length}</span>
          ${progressBar(k, items.length, c.name)}
        </a>
      </li>`;
  }).join('');
  setPage('כרטיסיות', `
    <a class="back" href="#/"><span aria-hidden="true">→</span> דף הבית</a>
    <h1>כרטיסיות</h1>
    <p>רואים את המוצר, מנסים להיזכר בשם, והופכים. מה שלא ידעת יחזור יותר.</p>
    <p class="summary">את/ה מכיר/ה <strong>${done}</strong> מתוך ${total} מוצרים.</p>
    <p><a class="btn" href="#/learn/all">כל המוצרים</a></p>
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

  setPage(`כרטיסיות: ${title}`, `
    <a class="back" href="#/learn"><span aria-hidden="true">→</span> כרטיסיות</a>
    <h1>${esc(title)}</h1>
    <div id="fc"></div>
  `);
  const box = document.getElementById('fc');

  function front() {
    if (pos >= deck.length) return finish();
    const p = deck[pos];
    box.innerHTML = `
      <section class="flash" aria-label="כרטיסייה">
        <p class="counter">כרטיס ${seen + 1}</p>
        ${clueHtml(p)}
        <p class="flash-q" tabindex="-1" id="fq">איך קוראים לזה?</p>
        <button class="btn btn-wide" id="flip" type="button">הפוך</button>
      </section>`;
    document.getElementById('flip').addEventListener('click', back);
  }

  function back() {
    const p = deck[pos];
    box.innerHTML = `
      <section class="flash" aria-label="כרטיסייה">
        ${clueHtml(p)}
        <h2 class="flash-name" tabindex="-1" id="ans">${esc(p.name)}</h2>
        <p class="price"><bdi>${esc(priceLabel(p))}</bdi></p>
        ${p.description ? `<p>${esc(p.description)}</p>` : ''}
        <div class="two">
          <button class="btn btn-no" id="no" type="button">✗ עוד לא</button>
          <button class="btn btn-yes" id="yes" type="button">✓ ידעתי</button>
        </div>
      </section>`;
    document.getElementById('ans').focus();
    document.getElementById('yes').addEventListener('click', () => answer(true));
    document.getElementById('no').addEventListener('click', () => answer(false));
  }

  function answer(knew) {
    const p = deck[pos];
    markResult(p.id, knew);
    if (knew) setKnown(p.id, true);
    else deck.splice(Math.min(deck.length, pos + 4), 0, p); // comes back in a few cards
    pos += 1;
    seen += 1;
    front();
    document.getElementById('fq')?.focus();
  }

  function finish() {
    box.innerHTML = `
      <section class="flash">
        <h2 tabindex="-1" id="done">סיימת את החבילה!</h2>
        <p>את/ה מכיר/ה ${knownCount(items)} מתוך ${items.length} מוצרים כאן.</p>
        <p><button class="btn" id="again" type="button">עוד סיבוב</button></p>
      </section>`;
    document.getElementById('done').focus();
    document.getElementById('again').addEventListener('click', () => {
      deck = weightedOrder(items); pos = 0; seen = 0; front();
    });
  }

  front();
}

/* ---------- games ---------- */

const GAMES = [
  { id: 'what', name: 'מה זה?', desc: 'רואים מוצר ובוחרים את השם הנכון.', ready: true },
  { id: 'made', name: 'ממה זה עשוי?', desc: 'שם של מוצר, ובוחרים מה יש בו.', ready: true },
  { id: 'price', name: 'כמה זה עולה?', desc: 'ניחוש מחיר.', ready: false },
  { id: 'who', name: 'מי המוצר?', desc: 'תיאור, ומזהים את המוצר.', ready: false },
  { id: 'customer', name: 'שאלת לקוח', desc: 'שאלות אמיתיות מהדלפק.', ready: false },
  { id: 'clock', name: 'נגד השעון', desc: 'כמה שיותר תשובות בדקה.', ready: false }
];

export function viewGames() {
  const items = GAMES.map((g) => g.ready
    ? `<li><a class="row-link" href="#/game/${g.id}">
         <span class="row-title">${esc(g.name)}</span>
         <span class="row-sub">${esc(g.desc)}${progress.best[g.id] ? ` · שיא: ${Number(progress.best[g.id].score)}/${Number(progress.best[g.id].of)}` : ''}</span>
       </a></li>`
    : `<li><span class="row-link disabled" aria-disabled="true">
         <span class="row-title">${esc(g.name)}</span>
         <span class="row-sub">בקרוב</span>
       </span></li>`).join('');
  setPage('משחקים', `
    <a class="back" href="#/"><span aria-hidden="true">→</span> דף הבית</a>
    <h1>משחקים</h1>
    <ul class="rows">${items}</ul>
  `);
}

const ROUND = 10;

function questionsWhat() {
  const showable = db.products.filter((p) => p.image && hintText(p));
  const pool = weightedOrder(showable).slice(0, ROUND);
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

function questionsMade() {
  const eligible = db.products.filter((p) => madeAnswers(p).length >= 1 && (p.ingredients || []).length >= 2);
  const pool = weightedOrder(eligible).slice(0, ROUND);
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

export function viewGame(id) {
  const game = GAMES.find((g) => g.id === id && g.ready);
  if (!game) return viewNotFound();
  const make = id === 'what' ? questionsWhat : questionsMade;
  let qs = make();
  let i = 0;
  let score = 0;
  let missed = [];

  // Compact header so all four answers fit on a phone screen without scrolling.
  setPage(game.name, `
    <h1 class="sr-only">${esc(game.name)}</h1>
    <div id="game"></div>
  `);
  const box = document.getElementById('game');

  function ask() {
    if (i >= qs.length) return end();
    const q = qs[i];
    box.innerHTML = `
      <section class="flash">
        <h2 class="sr-only" tabindex="-1" id="qh">שאלה ${i + 1} מתוך ${qs.length}${id === 'what' ? ': מה זה?' : ''}</h2>
        <p class="game-head">
          <a href="#/games" aria-label="חזרה למשחקים">→</a>
          <strong>${esc(game.name)}</strong>
          <span>${i + 1}/${qs.length} · ניקוד ${score}</span>
        </p>
        ${q.prompt}
        <div class="options" role="group" aria-label="תשובות">
          ${q.options.map((o, k) => `<button class="opt" type="button" data-k="${k}">${esc(o)}</button>`).join('')}
        </div>
        <div id="feedback"></div>
      </section>`;
    box.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.k))));
  }

  function choose(k) {
    const q = qs[i];
    const ok = k === q.correct;
    if (ok) score += 1; else missed.push(q.id);
    markResult(q.id, ok);
    box.querySelectorAll('.opt').forEach((b) => {
      const n = Number(b.dataset.k);
      b.disabled = true;
      if (n === q.correct) { b.classList.add('right'); b.textContent = `✓ ${b.textContent}`; }
      else if (n === k) { b.classList.add('wrong'); b.textContent = `✗ ${b.textContent}`; }
    });
    const fb = document.getElementById('feedback');
    fb.innerHTML = `
      <p class="verdict ${ok ? 'ok' : 'bad'}" id="verdict">${ok ? '✓ נכון!' : '✗ לא נכון'}</p>
      <p class="explain">${esc(q.explain)}</p>
      <button class="btn btn-wide" id="next" type="button" aria-describedby="verdict">${i + 1 < qs.length ? 'הבא' : 'לתוצאה'}</button>`;
    announce(ok ? 'נכון' : `לא נכון. התשובה: ${q.options[q.correct]}`);
    const next = document.getElementById('next');
    next.addEventListener('click', () => { i += 1; ask(); document.getElementById('qh')?.focus(); });
    next.focus();
  }

  function end() {
    const prev = progress.best[id];
    const record = !prev || score / qs.length > prev.score / prev.of;
    if (record) { progress.best[id] = { score, of: qs.length }; saveProgress(); }
    const newBest = record && prev;
    const review = missed.length
      ? `<h3>כדאי לחזור על</h3>
         <ul class="missed">${[...new Set(missed)].map((pid) => db.byId.get(pid)).filter(Boolean).map((p) => `
           <li><a href="#/p/${encodeURIComponent(p.id)}">${imgHtml(p, 'mini', 120, '')}<span>${esc(p.name)}</span></a></li>`).join('')}
         </ul>`
      : '';
    box.innerHTML = `
      <section class="flash result">
        ${newBest ? '<p class="celebrate" aria-hidden="true">🎉</p>' : ''}
        <h2 tabindex="-1" id="res" class="score"><bdi>${score}/${qs.length}</bdi></h2>
        <p>${newBest ? 'שיא חדש! ' : ''}${score >= 8 ? 'מעולה!' : score >= 5 ? 'יפה, עוד קצת ואת/ה שם.' : 'כדאי לעבור על הכרטיסיות ולנסות שוב.'}</p>
        ${review}
        <div class="two">
          <a class="btn btn-no" href="#/games">משחקים</a>
          <button class="btn btn-yes" id="again" type="button">עוד סיבוב</button>
        </div>
      </section>`;
    document.getElementById('res').focus();
    document.getElementById('again').addEventListener('click', () => { qs = make(); i = 0; score = 0; missed = []; ask(); });
  }

  ask();
}
