/* "שבוע ראשון": a guided path for new staff. One stop a day, in the order the counter needs them:
   cards for the day's products, then a short quiz. A final test at the end, and a certificate. */

import { db, esc, setPage, catIcon, meter, fillMeters, announce, focusMain } from './core.js';
import { progress, saveProgress, knownCount } from './progress.js';
import { viewNotFound, ring } from './catalog.js';
import { viewFlashcards, viewGame, questionsFor, jerusalemDate } from './learn.js';
import { myPlayer } from './cloud.js';
import { shower, countUp } from './fx.js';

// Breads and pastries first (most of the counter), the delicate patisserie and cakes last.
const DAYS = [
  { cats: ['breads'], title: 'לחמים' },
  { cats: ['pastries'], title: 'מאפים' },
  { cats: ['sandwiches', 'pizzas'], title: 'כריכים ופיצות' },
  { cats: ['salads', 'drinks'], title: 'סלטים ושתייה' },
  { cats: ['cookies', 'tarts'], title: 'עוגיות וטארטים' },
  { cats: ['patisserie'], title: 'פטיסרי' },
  { cats: ['cakes', 'boxes'], title: 'עוגות ומארזים' }
];
const QUIZ_LEN = 8;
const FINAL_LEN = 15;
const PASS = 0.7;
const FINAL_PASS = 0.8;

const dayItems = (d) => d.cats.flatMap((c) => db.byCat.get(c) || []);
const days = () => DAYS.map((d, k) => ({ ...d, n: k + 1, items: dayItems(d) })).filter((d) => d.items.length);
const state = (n) => progress.onboard.days[n] || { cards: false, quiz: null, passed: false };
const unlocked = (list, k) => k === 0 || state(list[k - 1].n).passed;
const allPassed = (list) => list.every((d) => state(d.n).passed);
const needed = (of, share) => Math.ceil(of * share);

function save(n, patch) {
  progress.onboard.days[n] = { ...state(n), ...patch };
  saveProgress();
}

const hebDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
};

export const onboardingDone = () => Boolean(progress.onboard.final && progress.onboard.final.passed);

/* ---------- the path ---------- */

export function viewOnboard() {
  const list = days();
  const doneCount = list.filter((d) => state(d.n).passed).length;
  const current = list.find((d, k) => unlocked(list, k) && !state(d.n).passed);
  const steps = list.map((d, k) => {
    const st = state(d.n);
    const open = unlocked(list, k);
    const status = st.passed ? '✓ עבר' : !open ? 'נעול' : st.cards ? 'נשאר מבחן' : 'מוכן';
    const body = `
      ${catIcon(d.cats[0])}
      <span class="row-title">יום ${d.n}: ${esc(d.title)}</span>
      <span class="soon${st.passed ? ' ok' : ''}">${status}</span>
      <span class="row-sub full">${d.items.length} מוצרים${st.quiz ? ` · מבחן: ${st.quiz.score}/${st.quiz.of}` : ''}</span>`;
    return `<li class="rise step${st.passed ? ' done' : ''}${current === d ? ' now' : ''}">
      ${open
        ? `<a class="row-link tint-${esc(d.cats[0])}" href="#/onboard/day/${d.n}"${current === d ? ' aria-current="step"' : ''}>${body}</a>`
        : `<span class="row-link disabled" aria-disabled="true">${body}</span>`}
    </li>`;
  }).join('');
  const fin = progress.onboard.final;
  const finalOpen = allPassed(list);
  setPage('שבוע ראשון', `
    <div class="onboard-hero">
      <p class="hello">חדשים בצוות?</p>
      <h1>שבוע ראשון</h1>
      <p>שבעה ימים, קטגוריה או שתיים בכל יום: קודם כרטיסיות, אחר כך מבחן קצר. בסוף יש מבחן מסכם ותעודה. מומלץ יום אחד ביום, אבל אפשר גם מהר יותר.</p>
      ${meter(doneCount, list.length, `${doneCount} מתוך ${list.length} ימים`)}
      <p class="counter">${doneCount} מתוך ${list.length} ימים</p>
      ${current ? `<a class="btn" href="#/onboard/day/${current.n}">${doneCount ? 'להמשיך' : 'להתחיל'}: יום ${current.n}</a>` : ''}
    </div>
    <ol class="rows steps">${steps}</ol>
    <h2>מבחן מסכם</h2>
    ${fin && fin.passed
      ? `<p><a class="btn" href="#/onboard/cert">לתעודה</a></p>`
      : finalOpen
        ? `<p>${FINAL_LEN} שאלות מכל הוויטרינה. עוברים מ־${needed(FINAL_LEN, FINAL_PASS)} נכונות.</p><p><a class="btn" href="#/onboard/final">למבחן המסכם</a></p>`
        : '<p class="counter">נפתח אחרי שעוברים את כל שבעת הימים.</p>'}
  `);
}

/* ---------- one day ---------- */

export function viewOnboardDay(n, step) {
  const list = days();
  const k = list.findIndex((d) => d.n === Number(n));
  if (k < 0 || !unlocked(list, k)) return viewNotFound();
  const d = list[k];
  const back = `#/onboard/day/${d.n}`;
  if (step === 'cards') {
    return viewFlashcards(d.cats[0], {
      items: d.items,
      title: `יום ${d.n}: ${d.title}`,
      back: { href: back, label: `יום ${d.n}` },
      onFinish: () => save(d.n, { cards: true }),
      next: { href: `#/onboard/day/${d.n}/quiz`, label: 'למבחן של היום' }
    });
  }
  if (step === 'quiz') {
    return viewGame(`onboard-${d.n}`, {
      name: `מבחן יום ${d.n}`,
      back,
      make: () => questionsFor(d.items, QUIZ_LEN),
      onEnd: ({ score, of, box, review }) => {
        const passed = score >= needed(of, PASS);
        const prev = state(d.n);
        const best = !prev.quiz || score / of > prev.quiz.score / prev.quiz.of ? { score, of } : prev.quiz;
        save(d.n, { quiz: best, passed: prev.passed || passed });
        const next = list[k + 1];
        box.innerHTML = `
          <section class="flash result q-in">
            ${ring(Math.round((score / of) * 100), 150, 64, `<span id="sc">0</span>/${of}`)}
            <h2 tabindex="-1" id="res" class="result-line">${passed ? `עברת את יום ${d.n}` : 'עוד קצת וזה שם'}</h2>
            <p>${passed ? (next ? `מחר: ${esc(next.title)}.` : 'עברת את כל הימים. נשאר המבחן המסכם.') : `צריך ${needed(of, PASS)} נכונות כדי לעבור. כדאי לעבור שוב על הכרטיסיות.`}</p>
            ${review}
            <div class="two">
              ${passed
                ? '<a class="btn btn-no" href="#/onboard">למסלול</a>'
                : `<a class="btn btn-no" href="#/onboard/day/${d.n}/cards">לכרטיסיות</a>`}
              ${passed
                ? (next ? `<a class="btn btn-yes" href="#/onboard/day/${next.n}">ליום ${next.n}</a>` : '<a class="btn btn-yes" href="#/onboard/final">למבחן המסכם</a>')
                : `<a class="btn btn-yes" href="#/onboard/day/${d.n}">לנסות שוב</a>`}
            </div>
          </section>`;
        fillMeters(box);
        countUp(document.getElementById('sc'), score);
        if (passed) setTimeout(shower, 300);
      }
    });
  }
  const st = state(d.n);
  const known = knownCount(d.items);
  setPage(`יום ${d.n}`, `
    <a class="back" href="#/onboard"><span aria-hidden="true">→</span> שבוע ראשון</a>
    <div class="banner tint-${esc(d.cats[0])}">
      ${catIcon(d.cats[0])}
      <div>
        <p class="hello">יום ${d.n} מתוך ${list.length}</p>
        <h1>${esc(d.title)}</h1>
        <p>${d.items.length} מוצרים · מוכרים לך ${known}</p>
      </div>
    </div>
    <ol class="rows steps">
      <li class="step${st.cards ? ' done' : ''}">
        <a class="row-link" href="#/onboard/day/${d.n}/cards">
          <span class="step-num" aria-hidden="true">1</span>
          <span class="row-title">כרטיסיות</span>
          <span class="soon${st.cards ? ' ok' : ''}">${st.cards ? '✓ עשית' : 'כמה דקות'}</span>
          <span class="row-sub full">עוברים על כל מוצר: תמונה, שם, מחיר ומה אומרים בצוות.</span>
        </a>
      </li>
      <li class="step${st.passed ? ' done' : ''}">
        <a class="row-link" href="#/onboard/day/${d.n}/quiz">
          <span class="step-num" aria-hidden="true">2</span>
          <span class="row-title">מבחן קצר</span>
          <span class="soon${st.passed ? ' ok' : ''}">${st.passed ? `✓ ${st.quiz.score}/${st.quiz.of}` : `${QUIZ_LEN} שאלות`}</span>
          <span class="row-sub full">עוברים מ־${needed(QUIZ_LEN, PASS)} נכונות. אפשר לנסות שוב כמה שרוצים.</span>
        </a>
      </li>
    </ol>
    <h2>המוצרים של היום</h2>
    <ul class="chips">${d.items.map((p) => `<li><a href="#/p/${encodeURIComponent(p.id)}">${esc(p.name)}</a></li>`).join('')}</ul>
  `);
}

/* ---------- final test and certificate ---------- */

export function viewOnboardFinal() {
  if (!allPassed(days())) return viewNotFound();
  viewGame('onboard-final', {
    name: 'מבחן מסכם',
    back: '#/onboard',
    make: () => questionsFor(db.products, FINAL_LEN),
    onEnd: ({ score, of, box, review }) => {
      const passed = score >= needed(of, FINAL_PASS);
      const prev = progress.onboard.final;
      if (passed && !(prev && prev.passed)) {
        progress.onboard.final = { score, of, date: jerusalemDate(), passed: true };
      } else if (!prev || (!prev.passed && score > prev.score)) {
        progress.onboard.final = { score, of, date: jerusalemDate(), passed };
      }
      saveProgress();
      box.innerHTML = `
        <section class="flash result q-in">
          ${ring(Math.round((score / of) * 100), 150, 64, `<span id="sc">0</span>/${of}`)}
          <h2 tabindex="-1" id="res" class="result-line">${passed ? 'עברת את ההכשרה' : 'כמעט'}</h2>
          <p>${passed ? 'התעודה שלך מחכה.' : `צריך ${needed(of, FINAL_PASS)} נכונות. כדאי לחזור על המוצרים שברשימה ולנסות שוב.`}</p>
          ${review}
          <div class="two">
            <a class="btn btn-no" href="#/onboard">למסלול</a>
            ${passed ? '<a class="btn btn-yes" href="#/onboard/cert">לתעודה</a>' : '<a class="btn btn-yes" href="#/onboard">לנסות שוב</a>'}
          </div>
        </section>`;
      fillMeters(box);
      countUp(document.getElementById('sc'), score);
      if (passed) setTimeout(shower, 300);
    }
  });
}

export function viewOnboardCert() {
  const fin = progress.onboard.final;
  if (!fin || !fin.passed) return viewNotFound();
  const player = myPlayer();
  const name = progress.onboard.name || (player && player.name) || '';
  setPage('תעודת הכשרה', `
    <section class="cert" aria-labelledby="cert-h">
      <svg class="cert-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15c2-6 6-9 9-9s7 3 9 9c-2 1.5-5 2.5-9 2.5S5 16.5 3 15z"/><path d="M8.5 8.5l1.5 8.5M15.5 8.5l-1.5 8.5M12 6.2v11"/></svg>
      <p class="cert-kicker">לארדו · רעננה</p>
      <h1 id="cert-h">תעודת הכשרה</h1>
      <p class="cert-stamp">עבר הכשרה ✓</p>
      <p class="cert-name">${name ? `<bdi>${esc(name)}</bdi>` : '<span class="counter">כאן יופיע השם</span>'}</p>
      <p>השלים את "שבוע ראשון": שבעה ימים של לימוד המוצרים ומבחן מסכם.</p>
      <dl class="cert-meta">
        <div><dt>תאריך</dt><dd>${esc(hebDate(fin.date))}</dd></div>
        <div><dt>מבחן מסכם</dt><dd><bdi>${fin.score}/${fin.of}</bdi></dd></div>
      </dl>
    </section>
    <form class="name-form cert-form" id="cert-form" novalidate>
      <label for="cert-name">השם על התעודה</label>
      <input id="cert-name" type="text" maxlength="20" autocomplete="off" value="${esc(name)}" aria-describedby="cert-hint">
      <p id="cert-hint" class="hint">נשמר רק בטלפון הזה.</p>
      <div class="two">
        <button class="btn btn-no" type="submit">שמירת השם</button>
        <button class="btn btn-yes" type="button" id="print">הדפסה או שמירה כ־PDF</button>
      </div>
    </form>
  `);
  document.getElementById('cert-form').addEventListener('submit', (e) => {
    e.preventDefault();
    progress.onboard.name = document.getElementById('cert-name').value.replace(/\s+/g, ' ').trim().slice(0, 20);
    saveProgress();
    viewOnboardCert();
    focusMain();
    announce('השם נשמר');
  });
  document.getElementById('print').addEventListener('click', () => window.print());
}
