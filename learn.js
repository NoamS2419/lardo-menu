'use strict';

/* Learning: personal progress, flashcards and the first two games.
   Uses the globals from app.js (db, esc, setPage, focusMain, live, ...). */

/* ---------- personal progress (this phone only) ---------- */

const PROGRESS_KEY = 'lardo.progress.v1';

function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    if (p && typeof p === 'object') return { known: {}, miss: {}, best: {}, ...p };
  } catch (e) { /* private mode or corrupt value: start fresh */ }
  return { known: {}, miss: {}, best: {} };
}

const progress = loadProgress();

function saveProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) { /* not saved, fine */ }
}

function markResult(id, correct) {
  if (correct) {
    progress.miss[id] = Math.max(0, (progress.miss[id] || 0) - 1);
  } else {
    progress.miss[id] = (progress.miss[id] || 0) + 1;
    delete progress.known[id];
  }
  saveProgress();
}

function setKnown(id, known) {
  if (known) progress.known[id] = true; else delete progress.known[id];
  saveProgress();
}

const knownCount = (items) => items.filter((p) => progress.known[p.id]).length;

const progressBar = (done, total, label) =>
  `<progress class="bar" max="${total}" value="${done}" aria-label="${esc(label)}: ${done} מתוך ${total}"></progress>`;

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

function clueHtml(p) {
  if (p.image) {
    return `<img class="quiz-img" src="${esc(imgSrc(p.image, 600))}" alt="תמונת המוצר" decoding="async">`;
  }
  const ing = (p.ingredients || []).map((i) => `<li>${esc(i)}</li>`).join('');
  return `
    <div class="clue">
      <p class="clue-label">עוד אין תמונה. המרכיבים:</p>
      <ul class="ingredients">${ing}</ul>
    </div>`;
}

/* ---------- learn hub ---------- */

function viewLearnHub() {
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
    <a class="back" href="#/">→ דף הבית</a>
    <h1>כרטיסיות</h1>
    <p>רואים את המוצר, מנסים להיזכר בשם, והופכים. מה שלא ידעת יחזור יותר.</p>
    <p class="summary">את/ה מכיר/ה <strong>${done}</strong> מתוך ${total} מוצרים.</p>
    <p><a class="btn" href="#/learn/all">כל המוצרים</a></p>
    <h2>לפי קטגוריה</h2>
    <ul class="rows">${rows}</ul>
  `);
}

/* ---------- flashcards ---------- */

function viewFlashcards(catId) {
  const items = catId === 'all' ? db.products : db.byCat.get(catId);
  const cat = db.categories.find((c) => c.id === catId);
  if (!items) return viewNotFound();
  const title = cat ? cat.name : 'כל המוצרים';
  let deck = weightedOrder(items);
  let pos = 0;
  let seen = 0;

  setPage(`כרטיסיות: ${title}`, `
    <a class="back" href="#/learn">→ כרטיסיות</a>
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
        <p class="flash-q">איך קוראים לזה?</p>
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
    document.querySelector('#fc .btn')?.focus();
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

function viewGames() {
  const items = GAMES.map((g) => g.ready
    ? `<li><a class="row-link" href="#/game/${g.id}">
         <span class="row-title">${esc(g.name)}</span>
         <span class="row-sub">${esc(g.desc)}${progress.best[g.id] != null ? ` · שיא: ${progress.best[g.id]}/10` : ''}</span>
       </a></li>`
    : `<li><span class="row-link disabled" aria-disabled="true">
         <span class="row-title">${esc(g.name)}</span>
         <span class="row-sub">בקרוב</span>
       </span></li>`).join('');
  setPage('משחקים', `
    <a class="back" href="#/">→ דף הבית</a>
    <h1>משחקים</h1>
    <ul class="rows">${items}</ul>
  `);
}

const ROUND = 10;

function questionsWhat() {
  const showable = db.products.filter((p) => p.image);
  const pool = weightedOrder(showable).slice(0, ROUND);
  return pool.map((p) => {
    const same = db.products.filter((o) => o.id !== p.id && o.category === p.category);
    const other = db.products.filter((o) => o.id !== p.id && o.category !== p.category);
    const wrong = pick(same, 3);
    if (wrong.length < 3) wrong.push(...pick(other, 3 - wrong.length));
    const options = shuffle([p, ...wrong]).map((o) => o.name);
    return {
      id: p.id,
      prompt: `${clueHtml(p)}<p class="flash-q">מה זה?</p>`,
      options,
      correct: options.indexOf(p.name),
      explain: `${p.name}. ${p.description || ''}`
    };
  });
}

function questionsMade() {
  // Short phrases make fair answers; long Wolt sentences give the answer away.
  const short = (i) => i.length <= 28 && i.split(' ').length <= 4;
  const all = [...new Set(db.products.flatMap((p) => (p.ingredients || []).filter(short)))];
  const eligible = db.products.filter((p) => (p.ingredients || []).filter(short).length >= 2);
  const pool = weightedOrder(eligible).slice(0, ROUND);
  return pool.map((p) => {
    const mine = norm([p.name, p.description, p.staff_description, ...(p.ingredients || [])].join(' '));
    // A wrong answer must not appear anywhere in this product's description.
    const wrongPool = all.filter((i) => !mine.includes(norm(i)) && !norm(i).split(' ').some((w) => w.length > 3 && mine.includes(w)));
    const right = pick(p.ingredients.filter(short), 1)[0];
    const options = shuffle([right, ...pick(wrongPool, 3)]);
    return {
      id: p.id,
      prompt: `<p class="flash-q">מה יש ב<strong>${esc(p.name)}</strong>?</p>`,
      options,
      correct: options.indexOf(right),
      explain: `${p.name}: ${p.description || (p.ingredients || []).join(', ')}`
    };
  });
}

function viewGame(id) {
  const game = GAMES.find((g) => g.id === id && g.ready);
  if (!game) return viewNotFound();
  const make = id === 'what' ? questionsWhat : questionsMade;
  let qs = make();
  let i = 0;
  let score = 0;

  setPage(game.name, `
    <a class="back" href="#/games">→ משחקים</a>
    <h1>${esc(game.name)}</h1>
    <div id="game"></div>
  `);
  const box = document.getElementById('game');

  function ask() {
    if (i >= qs.length) return end();
    const q = qs[i];
    box.innerHTML = `
      <section class="flash">
        <p class="counter">שאלה ${i + 1} מתוך ${qs.length} · ניקוד ${score}</p>
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
    if (ok) score += 1;
    markResult(q.id, ok);
    box.querySelectorAll('.opt').forEach((b) => {
      const n = Number(b.dataset.k);
      b.disabled = true;
      if (n === q.correct) { b.classList.add('right'); b.textContent = `✓ ${b.textContent}`; }
      else if (n === k) { b.classList.add('wrong'); b.textContent = `✗ ${b.textContent}`; }
    });
    const fb = document.getElementById('feedback');
    fb.innerHTML = `
      <p class="verdict ${ok ? 'ok' : 'bad'}">${ok ? '✓ נכון!' : '✗ לא נכון'}</p>
      <p class="explain">${esc(q.explain)}</p>
      <button class="btn btn-wide" id="next" type="button">${i + 1 < qs.length ? 'הבא' : 'לתוצאה'}</button>`;
    live.textContent = ok ? 'נכון' : `לא נכון. התשובה: ${q.options[q.correct]}`;
    const next = document.getElementById('next');
    next.addEventListener('click', () => { i += 1; ask(); box.querySelector('.opt, .btn')?.focus(); });
    next.focus();
  }

  function end() {
    const prev = progress.best[id];
    const record = prev == null || score > prev;
    if (record) { progress.best[id] = score; saveProgress(); }
    box.innerHTML = `
      <section class="flash">
        <h2 tabindex="-1" id="res">${score} מתוך ${qs.length}</h2>
        <p>${record && prev != null ? 'שיא חדש! ' : ''}${score >= 8 ? 'מעולה!' : score >= 5 ? 'יפה, עוד קצת ואת/ה שם.' : 'כדאי לעבור על הכרטיסיות ולנסות שוב.'}</p>
        <div class="two">
          <a class="btn btn-no" href="#/games">משחקים</a>
          <button class="btn btn-yes" id="again" type="button">עוד סיבוב</button>
        </div>
      </section>`;
    document.getElementById('res').focus();
    document.getElementById('again').addEventListener('click', () => { qs = make(); i = 0; score = 0; ask(); });
  }

  ask();
}
