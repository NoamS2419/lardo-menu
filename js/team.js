/* The team page: daily challenge results and the overall board. */

import { db, esc, setPage, announce, focusMain, meter, fillMeters } from './core.js';
import { progress } from './progress.js';
import { teamProgressEnabled, cloudEnabled, myPlayer, claimName, syncTotal, submitDaily, loadBoard, loadDaily, deleteMe } from './cloud.js';
import { jerusalemDate } from './learn.js';

// After an await the person may have moved on; don't paint over another page.
const stillHere = () => location.hash === '#/team';

const NOTICE = 'השם יופיע בטבלת הניקוד, שכל מי שיש לו את הקישור לאתר יכול לראות. מומלץ כינוי. אפשר למחוק אותו ואת הניקוד בכל רגע מהעמוד הזה. המשחק התנדבותי ונועד בשביל הכיף, לא להערכת עובדים.';

const table = (caption, rows, scoreLabel, scoreOf) => rows.length
  ? `<table class="board">
       <caption>${caption}</caption>
       <thead><tr><th scope="col">מקום</th><th scope="col">שם</th><th scope="col">${scoreLabel}</th></tr></thead>
       <tbody>${rows.map((r, i) => `
         <tr class="${r.me ? 'me' : ''}${i < 3 ? ` top${i + 1}` : ''}">
           <td><span class="rank">${i + 1}</span></td>
           <th scope="row"><bdi>${esc(r.name)}</bdi>${r.me ? ' <span class="you">(אני)</span>' : ''}</th>
           <td><bdi>${esc(scoreOf(r))}</bdi></td>
         </tr>`).join('')}
       </tbody>
     </table>`
  : `<p class="empty">${caption}: עוד אין תוצאות.</p>`;

/* ---------- team progress: who finished onboarding, how much of each category they know ---------- */

function parseKnown(s) {
  const out = new Map();
  for (const part of String(s || '').split(',')) {
    const [id, v] = part.split(':');
    if (id && db.byCat.has(id) && /^\d+$/.test(v || '')) out.set(id, Math.min(100, Number(v)));
  }
  return out;
}

function progressHtml(players) {
  const cats = db.categories.filter((c) => (db.byCat.get(c.id) || []).length);
  const rows = players
    .filter((r) => typeof r.known === 'string' || r.onboarded != null)
    .map((r) => {
      const known = parseKnown(r.known);
      let have = 0;
      let all = 0;
      for (const c of cats) { const n = db.byCat.get(c.id).length; all += n; have += ((known.get(c.id) || 0) / 100) * n; }
      const pct = all ? Math.round((have / all) * 100) : 0;
      const weakest = cats.slice().sort((a, b) => (known.get(a.id) || 0) - (known.get(b.id) || 0))[0];
      return { ...r, known, pct, weakest };
    })
    .sort((a, b) => b.pct - a.pct);
  if (!rows.length) return '<p class="empty">התקדמות הצוות: עוד אין נתונים.</p>';
  return `
    <section aria-labelledby="prog-h">
      <h2 id="prog-h">התקדמות הצוות</h2>
      <p class="hint">כמה מהוויטרינה כל אחד מכיר, מי סיים את "שבוע ראשון", ומה כדאי לחזק.</p>
      <ul class="team-progress">${rows.map((r) => `
        <li class="tp${r.me ? ' me' : ''}">
          <p class="tp-head">
            <bdi class="tp-name">${esc(r.name)}</bdi>${r.me ? ' <span class="you">(אני)</span>' : ''}
            <span class="soon${r.onboarded ? ' ok' : ''}">${r.onboarded ? '✓ הכשרה הושלמה' : 'בהכשרה'}</span>
          </p>
          ${meter(r.pct, 100, `${r.name}: ${r.pct}% מהמוצרים`)}
          <p class="tp-sub"><span>ידע: <bdi>${r.pct}%</bdi></span>${r.weakest ? `<span>כדאי לחזק: ${esc(r.weakest.name)}</span>` : ''}</p>
          <details>
            <summary>לפי קטגוריה</summary>
            <ul class="tp-cats">${cats.map((c) => `
              <li><span>${esc(c.name)}</span>${meter(r.known.get(c.id) || 0, 100, `${c.name}: ${r.known.get(c.id) || 0}%`)}<bdi>${r.known.get(c.id) || 0}%</bdi></li>`).join('')}
            </ul>
          </details>
        </li>`).join('')}
      </ul>
    </section>`;
}

function nameForm(current = '') {
  return `
    <form class="name-form" id="name-form" novalidate>
      <label for="nick">השם או הכינוי שלך</label>
      <input id="nick" name="nick" type="text" maxlength="20" autocomplete="off" autocapitalize="off"
             placeholder="למשל: נועה מהדלפק" value="${esc(current)}" aria-describedby="nick-notice nick-err">
      <p id="nick-notice" class="hint">${NOTICE}</p>
      <p id="nick-err" class="form-err" role="alert"></p>
      <button class="btn" type="submit">${current ? 'שמירה' : 'להצטרף לטבלה'}</button>
    </form>`;
}

function bindNameForm(after) {
  const form = document.getElementById('name-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('nick-err');
    const btn = form.querySelector('button');
    // aria-disabled, not disabled: a disabled button drops keyboard focus to <body>.
    if (btn.getAttribute('aria-disabled') === 'true') return;
    btn.setAttribute('aria-disabled', 'true');
    err.textContent = '';
    form.nick.removeAttribute('aria-invalid');
    const fail = (msg) => {
      err.textContent = msg;
      form.nick.setAttribute('aria-invalid', 'true');
      form.nick.focus();
    };
    try {
      const r = await claimName(form.nick.value, progress.gameXp || 0);
      if (r.error) return fail(r.error);
      // A daily score from before joining goes up now (submitDaily is safe to repeat).
      const today = jerusalemDate();
      if (progress.daily[today] != null) submitDaily(today, progress.daily[today]).catch(() => {});
      if (!stillHere()) return;
      after();
      focusMain();
      announce(`נרשמת בשם ${r.name}`);
    } catch (ex) {
      if (ex.code === 'RESET' && stillHere()) { viewTeam(); return; }
      fail('לא הצלחנו להתחבר. בדקו אינטרנט ונסו שוב.');
      console.error(ex);
    } finally {
      btn.removeAttribute('aria-disabled');
    }
  });
}

export async function viewTeam() {
  const date = jerusalemDate();
  const todayScore = progress.daily[date];
  const dailyCta = todayScore == null
    ? '<a class="btn btn-wide" href="#/game/daily">לאתגר היומי</a>'
    : `<p class="done-today">היום עשית את האתגר: <strong><bdi>${todayScore}/10</bdi></strong>. מחר יש חדש.</p>`;

  if (!cloudEnabled()) {
    setPage('הצוות', `
      <h1>טבלת הצוות</h1>
      <p>טבלת הניקוד המשותפת תיפתח בקרוב. בינתיים אפשר כבר לשחק באתגר היומי, הוא זהה לכל הצוות.</p>
      ${dailyCta}
    `);
    return;
  }

  const me = myPlayer();
  if (!me) {
    setPage('הצוות', `
      <h1>טבלת הצוות</h1>
      <p>כדי להופיע בטבלה צריך שם או כינוי. בלי סיסמה, בלי מייל.</p>
      ${nameForm()}
    `);
    bindNameForm(() => viewTeam());
    return;
  }

  setPage('הצוות', `
    <h1>טבלת הצוות</h1>
    ${dailyCta}
    <div id="boards" aria-busy="true"><p class="loading">טוען את הטבלה…</p></div>
    <details class="settings">
      <summary>הכינוי שלי והנתונים שלי</summary>
      ${nameForm(me.name)}
      <h2>מחיקת הנתונים</h2>
      <p>מוחק את הכינוי והניקוד מהטבלה ומהטלפון הזה. ההתקדמות האישית שלך בכרטיסיות נשארת בטלפון.</p>
      <button class="btn btn-no" id="delete-me" type="button">מחיקת הנתונים שלי</button>
      <p id="delete-msg" role="status"></p>
    </details>
  `);
  bindNameForm(() => viewTeam());
  document.getElementById('delete-me').addEventListener('click', async () => {
    if (!confirm('למחוק את הכינוי והניקוד שלך מהטבלה?')) return;
    const msg = document.getElementById('delete-msg');
    try {
      await deleteMe();
      if (!stillHere()) return;
      viewTeam();
      focusMain();
      announce('הנתונים נמחקו');
    } catch (ex) {
      msg.textContent = 'המחיקה לא הצליחה. נסו שוב בעוד רגע.';
      console.error(ex);
    }
  });

  const boards = document.getElementById('boards');
  try {
    await syncTotal(progress.gameXp || 0);
    const [daily, all] = await Promise.all([loadDaily(date), loadBoard()]);
    if (!stillHere()) return;
    boards.innerHTML = `
      ${table('האתגר של היום', daily, 'תוצאה', (r) => `${r.score}/10`)}
      ${table('הטבלה הכללית', all, 'נקודות', (r) => r.total)}
      ${teamProgressEnabled() ? progressHtml(all) : ''}`;
    fillMeters(boards);
  } catch (ex) {
    if (!stillHere()) return;
    if (ex.code === 'RESET') { viewTeam(); return; }
    boards.innerHTML = '<p class="empty">לא הצלחנו לטעון את הטבלה. נסו לרענן.</p>';
    console.error(ex);
  } finally {
    boards.removeAttribute('aria-busy');
  }
}
