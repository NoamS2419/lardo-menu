/* The team page: daily challenge results and the overall board. */

import { esc, setPage, announce } from './core.js';
import { progress } from './progress.js';
import { cloudEnabled, myPlayer, claimName, syncTotal, loadBoard, loadDaily, deleteMe } from './cloud.js';
import { jerusalemDate } from './learn.js';

const NOTICE = 'השם יופיע בטבלת הניקוד לכל הצוות. אפשר לכתוב כינוי. אפשר למחוק אותו ואת הניקוד בכל רגע מהעמוד הזה. המשחק התנדבותי ונועד בשביל הכיף, לא להערכת עובדים.';

const table = (caption, rows, scoreLabel, scoreOf) => rows.length
  ? `<table class="board">
       <caption>${caption}</caption>
       <thead><tr><th scope="col">מקום</th><th scope="col">שם</th><th scope="col">${scoreLabel}</th></tr></thead>
       <tbody>${rows.map((r, i) => `
         <tr class="${r.me ? 'me' : ''}${i < 3 ? ` top${i + 1}` : ''}">
           <td><span class="rank">${i + 1}</span></td>
           <th scope="row"><bdi>${esc(r.name)}</bdi>${r.me ? ' <span class="you">(את/ה)</span>' : ''}</th>
           <td><bdi>${esc(scoreOf(r))}</bdi></td>
         </tr>`).join('')}
       </tbody>
     </table>`
  : `<p class="empty">${caption}: עוד אין תוצאות.</p>`;

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
    btn.disabled = true;
    err.textContent = '';
    try {
      const r = await claimName(form.nick.value, progress.gameXp || 0);
      if (r.error) { err.textContent = r.error; return; }
      announce(`נרשמת בשם ${r.name}`);
      after();
    } catch (ex) {
      err.textContent = 'לא הצלחנו להתחבר. בדקו אינטרנט ונסו שוב.';
      console.error(ex);
    } finally {
      btn.disabled = false;
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
      msg.textContent = 'הנתונים נמחקו.';
      viewTeam();
    } catch (ex) {
      msg.textContent = 'המחיקה לא הצליחה. נסו שוב בעוד רגע.';
      console.error(ex);
    }
  });

  const boards = document.getElementById('boards');
  try {
    await syncTotal(progress.gameXp || 0);
    const [daily, all] = await Promise.all([loadDaily(date), loadBoard()]);
    boards.innerHTML = `
      ${table('האתגר של היום', daily, 'תוצאה', (r) => `${r.score}/10`)}
      ${table('הטבלה הכללית', all, 'נקודות', (r) => r.total)}`;
  } catch (ex) {
    boards.innerHTML = '<p class="empty">לא הצלחנו לטעון את הטבלה. נסו לרענן.</p>';
    console.error(ex);
  } finally {
    boards.removeAttribute('aria-busy');
  }
}
