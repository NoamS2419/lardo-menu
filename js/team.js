/* The team page: daily challenge results and the overall board. */

import { db, esc, setPage, announce, focusMain, meter, fillMeters } from './core.js';
import { progress, saveProgress } from './progress.js';
import { teamProgressEnabled, cloudEnabled, myPlayer, syncTotal, submitDaily, loadBoard, loadDaily, leaveBoard, cleanupExpired } from './cloud.js';
import { account, loadMember } from './account.js';
import { jerusalemDate } from './learn.js';

// After an await the person may have moved on; don't paint over another page.
const stillHere = () => location.hash === '#/team';

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
      <p class="hint">כמה מהוויטרינה מוכר לכל אחד בצוות, ומי השלים את "שבוע ראשון". ההתקדמות מוצגת כאן רק בהסכמה. ההמלצה "כדאי לחזק" מוצגת רק לך.</p>
      <ul class="team-progress">${rows.map((r) => `
        <li class="tp${r.me ? ' me' : ''}">
          <p class="tp-head">
            <bdi class="tp-name">${esc(r.name)}</bdi>${r.me ? ' <span class="you">(אני)</span>' : ''}
            <span class="soon${r.onboarded ? ' ok' : ''}">${r.onboarded ? '✓ הכשרה הושלמה' : 'בהכשרה'}</span>
          </p>
          ${meter(r.pct, 100, `${r.name}: ${r.pct}% מהמוצרים`)}
          <p class="tp-sub"><span>ידע: <bdi>${r.pct}%</bdi></span>${r.me && r.weakest ? `<span>כדאי לחזק: ${esc(r.weakest.name)}</span>` : ''}</p>
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

  let member = null;
  if (account()) { try { member = await loadMember(); } catch (e) { member = null; } }
  if (!stillHere()) return;
  if (!member || member.status !== 'approved') {
    setPage('הצוות', `
      <h1>טבלת הצוות</h1>
      <p>הטבלה פתוחה לעובדים שאושרו במערכת המשמרות, עם השם מהסידור. המשחקים והאתגר היומי פתוחים לכולם.</p>
      ${member ? '<p class="note">הבקשה להצטרף עוד ממתינה לאישור.</p>' : '<a class="btn btn-wide" href="#/shifts">כניסה או הרשמה</a>'}
      ${dailyCta}
    `);
    return;
  }
  // A daily score from before signing in goes up now (submitDaily is safe to repeat).
  if (progress.daily[date] != null) submitDaily(date, progress.daily[date]).catch(() => {});

  setPage('הצוות', `
    <h1>טבלת הצוות</h1>
    ${dailyCta}
    <div id="boards" aria-busy="true"><p class="empty">הטבלה בטעינה…</p></div>
    <details class="settings">
      <summary>הנתונים שלי בטבלה</summary>
      <p>השם בטבלה הוא השם מהסידור: <bdi>${esc(member.name)}</bdi>. רק עובדים מאושרים רואים את הטבלה. היא בשביל הכיף, לא להערכת עובדים.</p>
      ${teamProgressEnabled() ? `
      <h2>ההתקדמות שלי</h2>
      <label class="toggle-row">
        <input type="checkbox" id="share" aria-describedby="share-hint"${progress.shareProgress ? ' checked' : ''}>
        להציג את ההתקדמות שלי לצוות
      </label>
      <p class="hint" id="share-hint">כבוי: הצוות רואה רק את השם והניקוד. דלוק: גם אחוז המוצרים המוכרים בכל קטגוריה, והאם "שבוע ראשון" הושלם.</p>
      <p id="share-msg" role="status"></p>` : ''}
      <h2>ההופעה בטבלה</h2>
      <label class="toggle-row">
        <input type="checkbox" id="on-board" aria-describedby="board-hint"${progress.offBoard ? '' : ' checked'}>
        להופיע בטבלת הצוות
      </label>
      <p class="hint" id="board-hint">כבוי: השם והניקוד יורדים מהטבלה ולא נשלחים יותר. למחיקת החשבון כולו: בלשונית משמרות.</p>
      <p id="delete-msg" role="status"></p>
    </details>
  `);
  document.getElementById('share')?.addEventListener('change', async (e) => {
    progress.shareProgress = e.target.checked;
    saveProgress();
    const msg = document.getElementById('share-msg');
    try {
      await syncTotal(progress.gameXp || 0);
      if (!stillHere()) return;
      msg.textContent = progress.shareProgress ? 'ההתקדמות שלך מוצגת לצוות.' : 'ההתקדמות שלך הוסרה מהטבלה.';
    } catch (ex) {
      msg.textContent = 'לא הצלחנו לעדכן. ננסה שוב בפעם הבאה.';
      console.error(ex);
    }
  });
  document.getElementById('on-board').addEventListener('change', async (e) => {
    progress.offBoard = !e.target.checked;
    saveProgress();
    const msg = document.getElementById('delete-msg');
    try {
      if (progress.offBoard) await leaveBoard(); else await syncTotal(progress.gameXp || 0);
      if (!stillHere()) return;
      msg.textContent = progress.offBoard ? 'השם והניקוד הוסרו מהטבלה.' : 'השם והניקוד חזרו לטבלה.';
    } catch (ex) {
      msg.textContent = 'לא הצלחנו לעדכן. כדאי לנסות שוב בעוד רגע.';
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
    cleanupExpired();
  } catch (ex) {
    if (!stillHere()) return;
    boards.innerHTML = '<p class="empty">לא הצלחנו לטעון את הטבלה. נסו לרענן.</p>';
    console.error(ex);
  } finally {
    boards.removeAttribute('aria-busy');
  }
}
