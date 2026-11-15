/* Or's screens ("ניהול סידור"): join requests and the team, submissions, building and publishing
   the schedule, branch settings, and (for the main admin) branches and who runs them.
   The rules decide what each account may do; these screens only offer it. */

import { esc, setPage, announce, focusMain, rosette, backLink, stillAt } from './core.js';
import {
  ADMIN_USERNAME, account, loadMember, runsBranch, loadBranches, loadBranch, forgetBranches, createBranch, DEFAULT_BRANCH,
  checkDisplayName
} from './account.js';
import { getDoc, setDoc, deleteDoc, list, setWrite, deleteWrite, commit } from './fs.js';
import {
  DAYS, WORK_DAYS, thisWeek, nextWeek, today, addDays, dayDate, short, weekRange, weekRangeText, closesAt, deadlineText,
  expiry, slotKey, hoursOf, openSlots, timeRange, weekId
} from './week.js';
import { busy, errorState, loadingHtml, plural, slotLabel, scheduleTable, viewAvailability } from './shifts.js';
import { shareImage } from './share.js';

// Someone who leaves comes off the team table at once: their board entry and daily scores go.
// Failures are ignored (the 3-month cleanup catches leftovers).
async function removeFromBoard(uid) {
  const daily = await list('daily', [['uid', '==', uid]], { limit: 400 }).catch(() => []);
  await Promise.allSettled([deleteDoc(`players/${uid}`), ...daily.map((d) => deleteDoc(`daily/${d.id}`))]);
}

const back = backLink;
// Slots whose people or start times differ between two schedules.
function slotsDiffer(a = {}, b = {}) {
  const sig = (l) => (l || []).map((p) => `${p.uid}@${p.start || ''}`).sort().join(',');
  return [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => sig((a || {})[k]) !== sig((b || {})[k]));
}

// Loads the signed-in scheduler (or admin) and their branch; anyone else goes back to the shifts tab.
async function gate(route) {
  setPage('ניהול סידור', `<h1 class="sr-only">ניהול סידור</h1>${loadingHtml()}`);
  const me = await loadMember();
  if (!stillAt(route)()) return null;
  if (!runsBranch(me)) { location.hash = '#/shifts'; return null; }
  const branch = await loadBranch(me.branch);
  if (!branch) throw new Error('branch not found');
  return { me, branch };
}

/* ---------- housekeeping ---------- */

// Creates next week's document with its closing time, so the deadline is enforced by the server.
async function ensureWeek(branch, week) {
  const d = await getDoc(`schedules/${weekId(branch.id, week)}`);
  const at = closesAt(branch, week);
  if (d && (d.status === 'published' || (d.closesAt && d.closesAt.getTime() === at.getTime()))) return d;
  const data = d
    ? { ...d, closesAt: at, expireAt: expiry(week) }
    : { branch: branch.id, week, status: 'open', closesAt: at, slots: {}, need: {}, changed: [], changedFor: [], expireAt: expiry(week) };
  delete data.id; delete data.updatedAt;
  await setDoc(`schedules/${weekId(branch.id, week)}`, data, { stamp: ['updatedAt'] });
  return { ...data, id: weekId(branch.id, week) };
}

// Stands in for a TTL policy: removes what is past its expiry (about 3 months), quietly.
async function cleanup(branch) {
  try {
    const now = new Date();
    // Filtered here rather than in the query, so no composite index is needed.
    const old = (rows) => rows.filter((d) => d.expireAt && d.expireAt < now);
    const [av, sch, dr, off, mem, pend] = await Promise.all([
      list('availability', [['branch', '==', branch.id]], { limit: 1000 }).then(old),
      list('schedules', [['branch', '==', branch.id]], { limit: 200 }).then(old),
      list('drafts', [['branch', '==', branch.id]], { limit: 200 }).then(old),
      list('timeoff', [['branch', '==', branch.id]], { limit: 500 }).then(old),
      list('members', [['branch', '==', branch.id], ['status', '==', 'disabled']], { limit: 100 }),
      list('members', [['branch', '==', branch.id], ['status', '==', 'pending']], { limit: 100 })
    ]);
    const writes = [
      ...av.map((d) => deleteWrite(`availability/${d.id}`)),
      ...sch.map((d) => deleteWrite(`schedules/${d.id}`)),
      ...dr.map((d) => deleteWrite(`drafts/${d.id}`)),
      ...off.map((d) => deleteWrite(`timeoff/${d.id}`))
    ];
    // Someone who left more than 3 months ago: their record, standing availability and board entries go too.
    // A sign-up nobody approved within 3 months is removed the same way.
    const stale = new Date(now.getTime() - 90 * 86400000);
    const gone = [...mem.filter((x) => x.expireAt && x.expireAt < now), ...pend.filter((x) => x.createdAt && x.createdAt < stale)];
    for (const m of gone) {
      writes.push(deleteWrite(`standing/${m.id}`), deleteWrite(`players/${m.id}`), deleteWrite(`progress/${m.id}`), deleteWrite(`members/${m.id}`));
    }
    await Promise.allSettled(writes.map((w) => commit([w])));
  } catch (e) { /* best effort */ }
}

/* ---------- the manage hub ---------- */

export async function viewManage() {
  const route = '#/shifts/manage';
  const here = stillAt(route);
  try {
    const g = await gate(route);
    if (!g) return;
    const { branch } = g;
    const nw = nextWeek();
    await ensureWeek(branch, nw).catch(() => null);
    const tw = thisWeek();
    const [members, avail, standing, wk, off, dNext, wNow, dNow] = await Promise.all([
      list('members', [['branch', '==', branch.id]]),
      list('availability', [['branch', '==', branch.id], ['week', '==', nw]]),
      list('standing', [['branch', '==', branch.id]]),
      getDoc(`schedules/${weekId(branch.id, nw)}`),
      list('timeoff', [['branch', '==', branch.id]]),
      getDoc(`drafts/${weekId(branch.id, nw)}`),
      getDoc(`schedules/${weekId(branch.id, tw)}`),
      getDoc(`drafts/${weekId(branch.id, tw)}`)
    ]);
    const unpublished = (pub, dr) => Boolean(pub && pub.status === 'published' && dr && slotsDiffer(pub.slots, dr.slots).length);
    if (!here()) return;
    cleanup(branch);
    const pending = members.filter((m) => m.status === 'pending');
    const staff = members.filter((m) => m.status === 'approved');
    const submitted = new Set(avail.map((a) => a.uid));
    const fixed = new Set(standing.map((s) => s.uid));
    // Whoever runs the schedule and hasn't submitted is probably not working shifts: no reminder for them.
    const missing = staff.filter((m) => !submitted.has(m.id) && !fixed.has(m.id) && m.role !== 'scheduler');
    const counted = staff.filter((m) => m.role !== 'scheduler' || submitted.has(m.id) || fixed.has(m.id));
    const done = counted.length - missing.length;
    const published = wk && wk.status === 'published';
    const soonOff = off.filter((o) => o.to >= today() && o.from <= addDays(today(), 14)).sort((a, b) => a.from.localeCompare(b.from));
    const reminder = `היי, אפשר להגיש זמינות לשבוע ${weekRangeText(nw)} ${deadlineText(branch)}: ${location.origin}${location.pathname}#/shifts`;
    const isAdmin = account()?.isAdmin;

    setPage('ניהול סידור', `
      ${back('#/shifts', 'משמרות')}
      <h1>ניהול סידור</h1>
      <p class="sub">${esc(branch.name)}, שבוע ${weekRange(nw)}</p>
      <ul class="list manage-list">
        <li><a class="row-link" href="#/shifts/people"><span class="row-title">בקשות הצטרפות והצוות</span>${pending.length ? `<span class="soon ok">${plural(pending.length, 'בקשה אחת', 'בקשות')}</span>` : '<span></span>'}<span class="row-sub full">${plural(staff.length, 'אדם אחד בצוות', 'אנשים בצוות')}</span></a></li>
        <li><a class="row-link" href="#/shifts/build"><span class="row-title">בניית הסידור</span><span class="soon${published && !unpublished(wk, dNext) ? ' ok' : ''}">${unpublished(wk, dNext) ? 'יש שינויים שלא פורסמו' : published ? 'פורסם' : 'טיוטה'}</span><span class="row-sub full">שבוע ${weekRange(nw)}</span></a></li>
        <li><a class="row-link" href="#/shifts/build?w=${thisWeek()}"><span class="row-title">הסידור של השבוע</span>${unpublished(wNow, dNow) ? '<span class="soon">יש שינויים שלא פורסמו</span>' : '<span></span>'}<span class="row-sub full">תיקונים לשבוע ${weekRange(thisWeek())}</span></a></li>
        <li><a class="row-link" href="#/shifts/menu"><span class="row-title">התפריט והמוצרים</span><span></span><span class="row-sub full">הסתרה, שמות, מחירים, מוצרים חדשים, שאלות וטיפים</span></a></li>
        <li><a class="row-link" href="#/shifts/settings"><span class="row-title">הגדרות</span><span></span><span class="row-sub full">משמרות, שעות, כמה אנשים צריך ומועד ההגשה</span></a></li>
        ${isAdmin ? '<li><a class="row-link" href="#/shifts/branches"><span class="row-title">סניפים וניהול סידור</span><span></span><span class="row-sub full">למנהל הראשי</span></a></li>' : ''}
      </ul>
      <section class="block" aria-labelledby="subs-h">
        <h2 id="subs-h">הגשות לשבוע הבא</h2>
        <p>${done} מתוך ${counted.length} הגישו${fixed.size ? ` (כולל זמינות קבועה)` : ''}. ההגשה נסגרת ${esc(deadlineText(branch).replace(/^עד /, 'ב'))}.</p>
        ${missing.length ? `<p>עוד לא הגישו: ${missing.map((m) => `<bdi>${esc(m.name)}</bdi>`).join(', ')}</p>
        <a class="btn ghost" href="https://wa.me/?text=${encodeURIComponent(reminder)}" target="_blank" rel="noopener noreferrer">לשלוח תזכורת בוואטסאפ</a>` : staff.length ? '<p class="ok-line">✓ כולם הגישו.</p>' : ''}
      </section>
      ${soonOff.length ? `<section class="block" aria-labelledby="off-h">
        <h2 id="off-h">בקשות חופש בשבועיים הקרובים</h2>
        <ul class="plain-list">${soonOff.map((o) => `<li><span><bdi>${esc(o.name)}</bdi>: ${o.to !== o.from ? timeRange(short(o.from), short(o.to)) : short(o.from)}${o.note ? `, <bdi>${esc(o.note)}</bdi>` : ''}</span></li>`).join('')}</ul>
      </section>` : ''}
    `);
  } catch (ex) {
    if (here()) errorState(ex, route.slice(1));
  }
}

/* ---------- the team: join requests, names, access ---------- */

export async function viewPeople() {
  const route = '#/shifts/people';
  const here = stillAt(route);
  try {
    const g = await gate(route);
    if (!g) return;
    const { me, branch } = g;
    const isAdmin = account()?.isAdmin;
    const members = (await list('members', [['branch', '==', branch.id]])).sort((a, b) => a.name.localeCompare(b.name, 'he'));
    if (!here()) return;
    const pending = members.filter((m) => m.status === 'pending');
    const staff = members.filter((m) => m.status === 'approved');
    const off = members.filter((m) => m.status === 'disabled');
    // The scheduler manages employees, never the main admin (the rules refuse it too).
    const editable = (m) => isAdmin || (m.id !== me.uid && m.role === 'staff' && m.username !== ADMIN_USERNAME);

    const row = (m) => `
      <li class="person" data-uid="${esc(m.id)}">
        <div class="person-head">
          <span class="person-name"><bdi>${esc(m.name)}</bdi>${m.role === 'scheduler' ? ' <span class="tag">ניהול סידור</span>' : ''}${m.id === me.uid ? ' <span class="you">(אני)</span>' : ''}</span>
          <span class="hint">שם משתמש: <bdi dir="ltr">${esc(m.username)}</bdi></span>
        </div>
        ${editable(m) ? `<div class="person-actions">
          ${m.status === 'pending' ? `
            <button class="btn small" type="button" data-act="approve">אישור</button>
            <button class="btn ghost small" type="button" data-act="reject">דחייה</button>` : ''}
          ${m.status === 'approved' ? `
            <a class="btn ghost small" href="#/shifts/people/${encodeURIComponent(m.id)}">הזנת זמינות</a>
            <button class="btn ghost small danger" type="button" data-act="disable">השבתה</button>` : ''}
          ${m.status === 'disabled' ? '<button class="btn ghost small" type="button" data-act="enable">החזרה לצוות</button>' : ''}
          <details class="more"><summary>עוד פעולות</summary>
            <div class="field"><label for="name-${esc(m.id)}">השם בסידור</label>
              <div class="pw"><input id="name-${esc(m.id)}" type="text" maxlength="20" value="${esc(m.name)}"><button class="btn ghost small" type="button" data-act="rename">שמירה</button></div></div>
            ${m.status !== 'disabled' && staff.length ? `<div class="field"><label for="same-${esc(m.id)}">זה אותו אדם כמו חשבון קודם (שכחו סיסמה)</label>
              <p class="hint">רק אחרי שמוודאים פנים אל פנים או בטלפון. החשבון הקודם יושבת, והמשמרות שלו יופיעו בחשבון הזה.</p>
              <div class="pw"><select id="same-${esc(m.id)}"><option value="">בחירה</option>${[...staff, ...off].filter((x) => x.id !== m.id).map((x) => `<option value="${esc(x.id)}">${esc(x.name)} (${esc(x.username)})</option>`).join('')}</select>
              <button class="btn ghost small" type="button" data-act="link">חיבור</button></div></div>` : ''}
            ${isAdmin && m.status === 'approved' ? `<button class="btn ghost small" type="button" data-act="role">${m.role === 'scheduler' ? 'הסרה מניהול הסידור' : 'מינוי לניהול הסידור'}</button>` : ''}
          </details>
        </div>` : ''}
        <p class="form-err" role="status"></p>
      </li>`;

    setPage('הצוות', `
      ${back('#/shifts/manage', 'ניהול סידור')}
      <h1>הצוות</h1>
      <section class="block" aria-labelledby="pend-h">
        <h2 id="pend-h">בקשות הצטרפות</h2>
        ${pending.length ? `<ul class="people">${pending.map(row).join('')}</ul>` : '<p class="muted">אין בקשות חדשות.</p>'}
        ${pending.length > 1 ? '<button class="btn ghost small" type="button" id="reject-all">דחיית כל הבקשות</button>' : ''}
      </section>
      <section class="block" aria-labelledby="staff-h">
        <h2 id="staff-h">בצוות</h2>
        ${staff.length ? `<ul class="people">${staff.map(row).join('')}</ul>` : '<p class="muted">עוד אין אף אחד.</p>'}
      </section>
      ${off.length ? `<section class="block" aria-labelledby="off-h"><h2 id="off-h">לא פעילים</h2>
        <p class="hint">נמחקים לגמרי 3 חודשים אחרי ההשבתה.</p>
        <ul class="people">${off.map(row).join('')}</ul></section>` : ''}
    `);

    const update = (m, data) => setDoc(`members/${m.id}`, data, { mask: Object.keys(data), stamp: ['updatedAt'] });
    const done = async (msg) => { if (!here()) return; await viewPeople(); announce(msg); };
    document.querySelectorAll('.person [data-act]').forEach((btn) => btn.addEventListener('click', () => busy(btn, async () => {
      const li = btn.closest('.person');
      const m = members.find((x) => x.id === li.dataset.uid);
      const err = li.querySelector('.form-err');
      err.textContent = '';
      try {
        switch (btn.dataset.act) {
          case 'approve': await update(m, { status: 'approved' }); return done(`${m.name} אושר. עכשיו אפשר להגיש זמינות.`);
          case 'reject':
            if (!confirm(`לדחות את הבקשה של ${m.name}?`)) return undefined;
            await deleteDoc(`members/${m.id}`); return done('הבקשה נדחתה');
          case 'disable': {
            const count = async (week) => {
              const [pub, dr] = await Promise.all([getDoc(`schedules/${weekId(branch.id, week)}`), getDoc(`drafts/${weekId(branch.id, week)}`)]);
              const c = (d) => Object.values((d && d.slots) || {}).filter((l) => l.some((p) => p.uid === m.id)).length;
              return Math.max(c(pub && pub.status === 'published' ? pub : null), c(dr));
            };
            const [nNow, nNext] = await Promise.all([count(thisWeek()), count(nextWeek())]);
            const shifts = (n) => (n === 1 ? 'במשמרת אחת' : `ב־${n} משמרות`);
            const where = [nNow ? `${shifts(nNow)} השבוע` : '', nNext ? `${shifts(nNext)} בשבוע הבא` : ''].filter(Boolean).join(' ו');
            if (!confirm(`להשבית את ${m.name}? הגישה למשמרות נחסמת מיד.${where ? ` שימו לב: משובץ ${where}. המשמרות יישארו בסידור עד שמתקנים אותן.` : ''}`)) return undefined;
            await update(m, { status: 'disabled', expireAt: new Date(Date.now() + 90 * 864e5) });
            await removeFromBoard(m.id);
            return done(`${m.name} הושבת`);
          }
          case 'enable': await update(m, { status: 'approved' }); return done(`${m.name} חזר לצוות`);
          case 'rename': {
            const n = checkDisplayName(document.getElementById(`name-${m.id}`).value);
            if (n.error) { err.textContent = n.error; return undefined; }
            await update(m, { name: n.name }); return done('השם עודכן');
          }
          case 'link': {
            const old = members.find((x) => x.id === document.getElementById(`same-${m.id}`).value);
            if (!old) { err.textContent = 'צריך לבחור את החשבון הקודם.'; return undefined; }
            if (!confirm(`לחבר את החשבון החדש של ${m.name} לחשבון הקודם של ${old.name}? החשבון הקודם יושבת.`)) return undefined;
            await update(m, { replaces: old.id, status: 'approved', name: old.name });
            if (old.status !== 'disabled') { await update(old, { status: 'disabled', expireAt: new Date(Date.now() + 90 * 864e5) }); await removeFromBoard(old.id); }
            return done('החשבונות חוברו');
          }
          case 'role': await update(m, { role: m.role === 'scheduler' ? 'staff' : 'scheduler' }); return done('התפקיד עודכן');
          default: return undefined;
        }
      } catch (ex) {
        err.textContent = ex.status === 403 ? 'אין הרשאה לפעולה הזו.' : 'הפעולה לא הצליחה. כדאי לנסות שוב.';
        console.error(ex);
        return undefined;
      }
    })));
    document.getElementById('reject-all')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      if (!confirm(`לדחות את כל ${pending.length} הבקשות?`)) return;
      await Promise.allSettled(pending.filter(editable).map((m) => deleteDoc(`members/${m.id}`)));
      await done('הבקשות נדחו');
    }));
  } catch (ex) {
    if (here()) errorState(ex, route.slice(1));
  }
}

// The scheduler enters availability for someone (no smartphone, or after the deadline).
export async function viewPersonAvailability(uid) {
  const route = location.hash;
  try {
    const g = await gate(route);
    if (!g) return;
    const m = await getDoc(`members/${uid}`);
    if (!stillAt(route)()) return;
    if (!m || m.branch !== g.branch.id) { location.hash = '#/shifts/people'; return; }
    await viewAvailability({ ...m, uid });
  } catch (ex) {
    if (stillAt(route)()) errorState(ex, route.slice(1));
  }
}

/* ---------- settings ---------- */

const TIMES = (() => { const t = []; for (let h = 5; h <= 22; h++) for (const mm of ['00', '30']) t.push(`${String(h).padStart(2, '0')}:${mm}`); return t; })();

export async function viewSettings() {
  const route = '#/shifts/settings';
  const here = stillAt(route);
  try {
    const g = await gate(route);
    if (!g) return;
    const branch = g.branch;
    const radios = (name, val, legend) => `
      <fieldset class="radios"><legend>${legend}</legend>
        ${[0, 1, 2, 3, 4, 5].map((d) => `<label><input type="radio" name="${name}" value="${d}"${val === d ? ' checked' : ''}> ${DAYS[d]}</label>`).join('')}
      </fieldset>`;
    const closeTime = branch.closeMin === 1440 ? 'end' : `${String(Math.floor(branch.closeMin / 60)).padStart(2, '0')}:${String(branch.closeMin % 60).padStart(2, '0')}`;
    setPage('הגדרות', `
      ${back('#/shifts/manage', 'ניהול סידור')}
      <h1>הגדרות</h1>
      <form id="settings" class="settings-form" novalidate>
        <section class="block"><h2>מועד ההגשה</h2>
          ${radios('closeDow', branch.closeDow, 'ההגשה לשבוע הבא נסגרת ביום')}
          <div class="field"><label for="closeTime">בשעה</label>
            <select id="closeTime"><option value="end"${closeTime === 'end' ? ' selected' : ''}>סוף היום (חצות)</option>${TIMES.map((t) => `<option${t === closeTime ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
          <label class="toggle-row"><input type="checkbox" id="lateOk"${branch.lateOk ? ' checked' : ''}> אחרי המועד אפשר עוד להגיש עד הפרסום (מסומן "באיחור")</label>
          ${radios('publishDow', branch.publishDow, 'הסידור מתפרסם בדרך כלל ביום')}
          <p class="hint">הפרסום תמיד ידני, בכפתור "פרסום" במסך הבנייה. היום הזה רק אומר לצוות מתי לצפות לסידור.</p>
        </section>
        <section class="block"><h2>המשמרות</h2>
          ${branch.shifts.map((s, i) => `
            <fieldset class="shift-row"><legend>משמרת ${i + 1}</legend>
              <div class="field"><label for="sn${i}">שם</label><input id="sn${i}" type="text" maxlength="12" value="${esc(s.name)}"></div>
              <div class="field"><label for="ss${i}">התחלה</label><input id="ss${i}" type="time" value="${esc(s.start)}"></div>
              <div class="field"><label for="se${i}">סיום</label><input id="se${i}" type="time" value="${esc(s.end)}"></div>
            </fieldset>`).join('')}
        </section>
        <section class="block"><h2>כמה אנשים בכל משמרת</h2>
          <p class="hint">0 = המשמרת סגורה. לשבוע חריג (חג) אפשר לשנות במסך הבנייה, לשבוע הזה בלבד.</p>
          <div class="sch-wrap"><table class="sch need">
            <caption class="sr-only">כמה אנשים בכל משמרת</caption>
            <thead><tr><td></td>${branch.shifts.map((s) => `<th scope="col">${esc(s.name)}</th>`).join('')}</tr></thead>
            <tbody>${WORK_DAYS.map((d) => `<tr><th scope="row">${DAYS[d]}</th>${branch.shifts.map((s) => {
              const k = slotKey(d, s.id);
              return `<td><input type="number" min="0" max="20" inputmode="numeric" id="need-${k}" value="${Number(branch.need[k] || 0)}" aria-label="${DAYS[d]}, ${esc(s.name)}: כמה אנשים"></td>`;
            }).join('')}</tr>`).join('')}</tbody>
          </table></div>
          <div class="field"><label for="friM">שעות שונות לשישי ${esc(branch.shifts[0].name)} (לא חובה)</label>
            <p class="hint">למשל 06:30-15:00. ריק = השעות הרגילות.</p>
            <input id="friM" type="text" dir="ltr" maxlength="11" value="${esc((branch.hours || {})[slotKey(5, branch.shifts[0].id)] || '')}" placeholder="06:30-15:00"></div>
        </section>
        <p class="form-err" id="form-err" role="alert"></p>
        <button class="btn btn-wide" type="submit">שמירה</button>
      </form>`);
    const form = document.getElementById('settings');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const err = document.getElementById('form-err');
        const ct = form.closeTime.value;
        const shifts = branch.shifts.map((s, i) => ({
          id: s.id,
          name: document.getElementById(`sn${i}`).value.trim().slice(0, 12) || s.name,
          start: document.getElementById(`ss${i}`).value || s.start,
          end: document.getElementById(`se${i}`).value || s.end
        }));
        const need = {};
        for (const d of WORK_DAYS) for (const s of branch.shifts) { const k = slotKey(d, s.id); need[k] = Math.max(0, Math.min(20, Number(document.getElementById(`need-${k}`).value) || 0)); }
        const fri = form.friM.value.replace(/\s/g, '');
        if (fri && !/^\d\d:\d\d-\d\d:\d\d$/.test(fri)) { err.textContent = 'שעות שישי: בצורה 06:30-15:00, או ריק.'; form.friM.focus(); return; }
        const hours = fri ? { [slotKey(5, branch.shifts[0].id)]: fri } : {};
        const data = {
          name: branch.name, active: branch.active,
          closeDow: Number(form.closeDow.value), closeMin: ct === 'end' ? 1440 : Number(ct.slice(0, 2)) * 60 + Number(ct.slice(3)),
          publishDow: Number(form.publishDow.value), lateOk: form.lateOk.checked, shifts, need, hours
        };
        try {
          await setDoc(`branches/${branch.id}`, data, { stamp: ['updatedAt'] });
          forgetBranches();
          const fresh = await loadBranch(branch.id);
          await ensureWeek(fresh, nextWeek()).catch(() => null);
        } catch (ex) { err.textContent = 'לא הצלחנו לשמור. כדאי לנסות שוב.'; console.error(ex); return; }
        if (!here()) return;
        location.hash = '#/shifts/manage';
        announce('ההגדרות נשמרו');
      });
    });
  } catch (ex) {
    if (here()) errorState(ex, route.slice(1));
  }
}

/* ---------- building the schedule ---------- */

const START_TIMES = TIMES.filter((t) => t >= '05:30' && t <= '17:00');

export async function viewBuild(weekParam) {
  const route = location.hash;
  const here = stillAt(route);
  try {
    const g = await gate(route);
    if (!g) return;
    const { branch } = g;
    const week = /^\d{4}-\d\d-\d\d$/.test(weekParam || '') ? weekParam : nextWeek();
    const prevWeek = addDays(week, -7);
    const [members, avail, standing, offAll, draftDoc, pub, prevPub] = await Promise.all([
      list('members', [['branch', '==', branch.id]]),
      list('availability', [['branch', '==', branch.id], ['week', '==', week]]),
      list('standing', [['branch', '==', branch.id]]),
      list('timeoff', [['branch', '==', branch.id]]),
      getDoc(`drafts/${weekId(branch.id, week)}`),
      getDoc(`schedules/${weekId(branch.id, week)}`),
      getDoc(`schedules/${weekId(branch.id, prevWeek)}`)
    ]);
    if (!here()) return;
    const published = pub && pub.status === 'published' ? pub : null;
    const staff = members.filter((m) => m.status === 'approved').sort((a, b) => a.name.localeCompare(b.name, 'he'));
    const deadline = (pub && pub.closesAt) || closesAt(branch, week);
    // What each person said: their submission, else their standing availability, else nothing.
    const said = new Map();
    for (const m of staff) {
      const a = avail.find((x) => x.uid === m.id);
      const s = standing.find((x) => x.uid === m.id);
      if (a) said.set(m.id, { slots: new Set(a.slots), note: a.note, kind: a.by === 'manager' ? 'manager' : a.updatedAt && a.updatedAt > deadline ? 'late' : 'sent' });
      else if (s) said.set(m.id, { slots: new Set(s.slots), note: s.note || '', kind: s.updatedAt && s.updatedAt > deadline ? 'late' : 'standing' });
    }
    // Time off turns that day's slots into "can't", labelled.
    const offOn = (uid, date) => offAll.find((o) => o.uid === uid && o.from <= date && o.to >= date);

    const state = {
      slots: JSON.parse(JSON.stringify((draftDoc && draftDoc.slots) || (published && published.slots) || {})),
      need: { ...branch.need, ...((published && published.need) || {}), ...((draftDoc && draftDoc.need) || {}) }
    };
    const fromDraft = Boolean(draftDoc);
    const open = () => openSlots(branch, state.need);
    const status = (uid, k, dow) => {
      const date = dayDate(week, dow);
      const o = offOn(uid, date);
      if (o) return { can: false, label: 'חופש', note: o.note };
      const s = said.get(uid);
      if (!s) return { can: null, label: 'לא הוגש' };
      return { can: s.slots.has(k), label: s.slots.has(k) ? 'אפשר' : 'אי אפשר', note: s.note };
    };
    const countFor = (uid) => Object.values(state.slots).filter((l) => l.some((p) => p.uid === uid)).length;
    const marked = (uid) => { const s = said.get(uid); return s ? [...s.slots].filter((k) => open().some((o) => o.key === k)).length : null; };

    function problems() {
      const out = [];
      const gaps = open().filter((o) => (state.slots[o.key] || []).length < Number(state.need[o.key] || 0));
      if (gaps.length) out.push(`חסרים אנשים ב־${plural(gaps.length, 'משמרת אחת', 'משמרות')}: ${gaps.map((o) => `${DAYS[o.dow]} ${o.shift.name}`).join(', ')}`);
      for (const o of open()) {
        for (const p of state.slots[o.key] || []) {
          const st = status(p.uid, o.key, o.dow);
          if (st.can === false) out.push(`${p.name} שובץ ב${DAYS[o.dow]} ${o.shift.name}, וסימן ${st.label === 'חופש' ? 'חופש' : '"אי אפשר"'}`);
        }
      }
      for (const d of WORK_DAYS) {
        const ids = branch.shifts.flatMap((s) => (state.slots[slotKey(d, s.id)] || []).map((p) => p.uid));
        const twice = [...new Set(ids.filter((u, i) => ids.indexOf(u) !== i))];
        for (const u of twice) out.push(`${(staff.find((m) => m.id === u) || { name: 'מישהו' }).name} משובץ פעמיים ב${DAYS[d]}. כדאי לבדוק שעות ומנוחה.`);
      }
      return out;
    }

    // Saving: only the slot that changed (so two devices don't overwrite each other), shortly after the last tap.
    let pendingKeys = new Set();
    let timer = null;
    const saveMsg = () => document.getElementById('save-state');
    async function flush() {
      const keys = [...pendingKeys]; pendingKeys = new Set(); timer = null;
      if (!keys.length) return;
      const data = { branch: branch.id, week, expireAt: expiry(week), slots: {}, need: {} };
      const mask = ['branch', 'week', 'expireAt'];
      for (const k of keys) {
        if (k.startsWith('need:')) { const s = k.slice(5); data.need[s] = Number(state.need[s] || 0); mask.push(`need.\`${s}\``); }
        else { data.slots[k] = state.slots[k] || []; mask.push(`slots.\`${k}\``); }
      }
      try {
        await setDoc(`drafts/${weekId(branch.id, week)}`, data, { mask, stamp: ['updatedAt'] });
        if (saveMsg()) saveMsg().textContent = published ? 'נשמר, עוד לא פורסם לצוות' : 'הטיוטה נשמרה';
        showUnpublished();
      } catch (ex) {
        keys.forEach((k) => pendingKeys.add(k));
        if (saveMsg()) saveMsg().textContent = 'הטיוטה לא נשמרה. ננסה שוב בשינוי הבא.';
        console.error(ex);
      }
    }
    const touch = (k) => { pendingKeys.add(k); if (saveMsg()) saveMsg().textContent = 'שומר…'; clearTimeout(timer); timer = setTimeout(flush, 800); };
    const flushNow = () => { if (timer) { clearTimeout(timer); flush(); } };
    window.addEventListener('hashchange', flushNow, { once: true });
    const onHide = () => { if (document.visibilityState === 'hidden') flushNow(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushNow);
    window.addEventListener('hashchange', () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', flushNow); }, { once: true });

    const changedSincePublish = () => (published ? slotsDiffer(published.slots, state.slots) : []);
    const showUnpublished = () => {
      const el = document.getElementById('unpub');
      if (el) el.hidden = !changedSincePublish().length;
    };

    function cellHtml(o) {
      const people = state.slots[o.key] || [];
      const need = Number(state.need[o.key] || 0);
      const missing = Math.max(0, need - people.length);
      const label = `${slotLabel(branch, o.dow, o.shift, week)}: ${people.length} מתוך ${need}${missing ? `, חסר ${missing}` : ''}${people.length ? `. ${people.map((p) => p.name + (p.start ? ` מ־${p.start}` : '')).join(', ')}` : ''}`;
      const clash = people.some((p) => status(p.uid, o.key, o.dow).can === false);
      return `<button type="button" class="cell${missing ? ' short' : ''}${clash ? ' clash' : ''}" data-k="${o.key}" aria-label="${esc(label)}">
        <span class="cell-count">${missing ? `חסר ${missing}` : `${people.length}/${need}`}</span>
        ${people.map((p) => `<span class="cell-name${status(p.uid, o.key, o.dow).can === false ? ' bad' : ''}"><bdi>${esc(p.name)}</bdi>${p.start ? ` <span class="start">${esc(p.start)}</span>` : ''}</span>`).join('')}
      </button>`;
    }

    function gridHtml() {
      const keys = new Set(open().map((o) => o.key));
      return `<table class="sch build">
        <caption class="sr-only">בניית הסידור לשבוע ${weekRange(week)}</caption>
        <thead><tr><td></td>${branch.shifts.map((s) => `<th scope="col">${esc(s.name)}<span class="d">${esc(timeRange(s.start, s.end))}</span></th>`).join('')}</tr></thead>
        <tbody>${WORK_DAYS.map((d) => `<tr><th scope="row">${DAYS[d]}<span class="d">${short(dayDate(week, d))}</span></th>${branch.shifts.map((s) => {
          const k = slotKey(d, s.id);
          return keys.has(k) ? `<td>${cellHtml(open().find((o) => o.key === k))}</td>` : `<td class="sch-closed"><button type="button" class="cell closed" data-k="${k}" aria-label="${esc(slotLabel(branch, d, s, week))}: סגורה. לפתוח לשבוע הזה">סגור</button></td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table>`;
    }

    function summaryHtml() {
      return `<ul class="plain-list summary">${staff.map((m) => {
        const s = said.get(m.id);
        const n = countFor(m.id);
        const mk = marked(m.id);
        const kind = !s ? 'לא הוגש' : s.kind === 'late' ? 'באיחור' : s.kind === 'standing' ? 'קבוע' : s.kind === 'manager' ? 'הוזן בניהול' : '';
        return `<li><span><bdi>${esc(m.name)}</bdi>: ${mk != null ? `<strong>${n}</strong> מתוך ${mk} שהוגשו` : plural(n, 'משמרת אחת', 'משמרות')}${kind ? ` <span class="tag">${kind}</span>` : ''}${s && s.note ? `<br><span class="hint">“<bdi>${esc(s.note)}</bdi>”</span>` : ''}</span></li>`;
      }).join('')}</ul>`;
    }

    const isPast = week < thisWeek();
    setPage('בניית הסידור', `
      ${back('#/shifts/manage', 'ניהול סידור')}
      <h1>בניית הסידור</h1>
      <p class="sub">שבוע ${weekRange(week)} ${published ? '<span class="tag">פורסם</span>' : '<span class="tag">טיוטה</span>'}</p>
      ${published ? `<p class="warn-line" id="unpub" role="status"${changedSincePublish().length ? '' : ' hidden'}>יש שינויים שעוד לא פורסמו. הצוות רואה את הגרסה הקודמת עד שלוחצים "פרסום העדכון".</p>` : ''}
      <p class="hint">לוחצים על משמרת כדי לשבץ. מי שסימן "אפשר" מופיע ראשון. הטיוטה נשמרת לבד, והצוות רואה רק את מה שפורסם.</p>
      ${!published && prevPub && prevPub.status === 'published' ? '<button class="btn ghost btn-wide" type="button" id="copy-prev">התחלה מהסידור של השבוע הקודם</button>' : ''}
      <div class="sch-wrap" id="grid">${gridHtml()}</div>
      <p class="hint" id="save-state" role="status"></p>
      <div class="publish-bar">
        <button class="btn btn-wide" type="button" id="publish"${isPast ? ' aria-disabled="true"' : ''}>${published ? 'פרסום העדכון' : 'פרסום הסידור'}</button>
        ${published ? '<button class="btn ghost btn-wide" type="button" id="share">תמונה לוואטסאפ</button>' : ''}
      </div>
      <section class="block" aria-labelledby="sum-h"><h2 id="sum-h">כמה משמרות לכל אחד</h2><p class="hint">שובצו מתוך המשמרות שסומנו "אפשר" בהגשה.</p><div id="summary">${summaryHtml()}</div></section>

      <dialog id="slot-dlg" class="sheet" aria-labelledby="dlg-h">
        <form method="dialog" class="sheet-in">
          <h2 id="dlg-h" tabindex="-1"></h2>
          <div class="field need-field"><label for="dlg-need">כמה אנשים צריך בשבוע הזה</label><input id="dlg-need" type="number" min="0" max="20" inputmode="numeric"></div>
          <ul class="pick" id="dlg-list"></ul>
          <p class="sr-only" id="dlg-live" aria-live="polite"></p>
          <button class="btn btn-wide" value="done">סיום</button>
        </form>
      </dialog>

      <dialog id="pub-dlg" class="sheet" role="alertdialog" aria-labelledby="pub-h" aria-describedby="pub-body">
        <form method="dialog" class="sheet-in">
          <h2 id="pub-h">${published ? 'לפרסם את העדכון?' : 'לפרסם את הסידור?'}</h2>
          <div id="pub-body"></div>
          <div class="two">
            <button class="btn ghost" value="cancel" autofocus>ביטול</button>
            <button class="btn" value="ok" id="pub-ok">פרסום</button>
          </div>
        </form>
      </dialog>
    `);

    const grid = document.getElementById('grid');
    const redraw = (focusKey) => {
      grid.innerHTML = gridHtml();
      document.getElementById('summary').innerHTML = summaryHtml();
      if (focusKey) grid.querySelector(`[data-k="${focusKey}"]`)?.focus();
    };

    // The slot sheet.
    const dlg = document.getElementById('slot-dlg');
    let current = null;
    function fillSheet() {
      const o = { key: current, dow: Number(current[0]), shift: branch.shifts.find((s) => s.id === current.slice(1)) };
      const people = state.slots[current] || [];
      document.getElementById('dlg-h').textContent = slotLabel(branch, o.dow, o.shift, week);
      document.getElementById('dlg-need').value = Number(state.need[current] || 0);
      const rank = (m) => { const st = status(m.id, current, o.dow); return st.can === true ? 0 : st.can === null ? 1 : 2; };
      const rows = staff.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'he'));
      document.getElementById('dlg-list').innerHTML = rows.map((m) => {
        const st = status(m.id, current, o.dow);
        const p = people.find((x) => x.uid === m.id);
        return `<li class="pick-row${st.can === false ? ' cant' : ''}">
          <button type="button" class="pick-btn" data-uid="${esc(m.id)}" aria-pressed="${Boolean(p)}" aria-label="לשבץ את ${esc(m.name)}">${p ? '✓' : '+'}</button>
          <span class="pick-name"><bdi>${esc(m.name)}</bdi><span class="pick-sub">${esc(st.label)}${st.note ? `, “<bdi>${esc(st.note)}</bdi>”` : ''} · ${plural(countFor(m.id), 'משמרת אחת', 'משמרות')}</span></span>
          ${p ? `<label class="sr-only" for="st-${esc(m.id)}">שעת התחלה ל${esc(m.name)}</label>
          <select id="st-${esc(m.id)}" class="pick-start" data-uid="${esc(m.id)}"><option value="">${esc(hoursOf(branch, o.dow, o.shift).start)}</option>${START_TIMES.map((t) => `<option${p.start === t ? ' selected' : ''}>${t}</option>`).join('')}</select>` : ''}
        </li>`;
      }).join('') || '<li class="muted">עוד אין אנשים מאושרים בצוות.</li>';
    }
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.cell');
      if (!btn) return;
      current = btn.dataset.k;
      fillSheet();
      dlg.showModal();
      document.getElementById('dlg-h').focus();
    });
    dlg.addEventListener('close', () => { const k = current; redraw(k); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // tap on the dimmed backdrop
    document.getElementById('dlg-list').addEventListener('click', (e) => {
      const b = e.target.closest('.pick-btn');
      if (!b) return;
      const m = staff.find((x) => x.id === b.dataset.uid);
      const list0 = state.slots[current] || [];
      const on = list0.some((p) => p.uid === m.id);
      state.slots[current] = on ? list0.filter((p) => p.uid !== m.id) : [...list0, { uid: m.id, name: m.name }];
      touch(current);
      fillSheet();
      document.querySelector(`.pick-btn[data-uid="${CSS.escape(m.id)}"]`)?.focus();
      const n = state.slots[current].length;
      document.getElementById('dlg-live').textContent = `${m.name} ${on ? 'הוסר' : 'שובץ'}. ${n} מתוך ${Number(state.need[current] || 0)}`;
    });
    document.getElementById('dlg-list').addEventListener('change', (e) => {
      const s = e.target.closest('.pick-start');
      if (!s) return;
      state.slots[current] = (state.slots[current] || []).map((p) => (p.uid === s.dataset.uid ? (s.value ? { ...p, start: s.value } : { uid: p.uid, name: p.name }) : p));
      touch(current);
    });
    document.getElementById('dlg-need').addEventListener('change', (e) => {
      state.need[current] = Math.max(0, Math.min(20, Number(e.target.value) || 0));
      touch(`need:${current}`);
    });

    document.getElementById('copy-prev')?.addEventListener('click', () => {
      if (Object.values(state.slots).some((l) => l.length) && !confirm('להחליף את מה שכבר שובץ בסידור של השבוע הקודם?')) return;
      const keys = new Set(open().map((o) => o.key));
      for (const k of Object.keys(state.slots)) { if (state.slots[k].length) { state.slots[k] = []; touch(k); } }
      // A re-linked account (forgot password) takes the old account's shifts.
      const who = (uid) => staff.find((m) => m.id === uid) || staff.find((m) => m.replaces === uid);
      for (const [k, l] of Object.entries(prevPub.slots || {})) {
        if (!keys.has(k)) continue;
        const seen = new Set();
        state.slots[k] = l.map((p) => ({ p, m: who(p.uid) })).filter(({ m }) => m && !seen.has(m.id) && seen.add(m.id))
          .map(({ p, m }) => ({ ...p, uid: m.id, name: m.name }));
        touch(k);
      }
      redraw();
      const clashes = problems().filter((t) => t.includes('וסימן')).length;
      announce(`הסידור הועתק מהשבוע הקודם.${clashes ? ` ${plural(clashes, 'שיבוץ אחד מתנגש', 'שיבוצים מתנגשים')} עם הזמינות, מסומנים באדום.` : ''}`);
    });

    // Publishing.
    const pubDlg = document.getElementById('pub-dlg');
    document.getElementById('publish').addEventListener('click', (e) => {
      if (e.currentTarget.getAttribute('aria-disabled') === 'true') return;
      const list1 = problems();
      document.getElementById('pub-body').innerHTML = `
        <p>${published ? 'השינויים יסומנו אצל הצוות כ"עודכן".' : 'כל הצוות יראה אותו מיד.'}</p>
        ${list1.length ? `<p class="warn-line">כדאי לבדוק לפני הפרסום:</p><ul class="checks">${list1.slice(0, 8).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}`;
      document.getElementById('pub-ok').textContent = list1.length ? 'פרסום בכל זאת' : 'פרסום';
      pubDlg.showModal();
    });
    pubDlg.addEventListener('close', async () => {
      const opener = document.getElementById('publish');
      if (pubDlg.returnValue !== 'ok') { opener?.focus(); return; }
      if (timer) { clearTimeout(timer); await flush(); }
      const changed = changedSincePublish();
      const changedFor = [...new Set(changed.flatMap((k) => [...(published?.slots[k] || []), ...(state.slots[k] || [])].map((p) => p.uid)))];
      const keys = new Set(open().map((o) => o.key));
      const slots = Object.fromEntries(Object.entries(state.slots).filter(([k, l]) => keys.has(k) && l.length));
      const data = {
        branch: branch.id, week, status: 'published', closesAt: deadline, slots, need: state.need, shifts: branch.shifts, hours: branch.hours || {},
        changed: published ? changed.slice(0, 42) : [], changedFor: published ? changedFor.slice(0, 80) : [], expireAt: expiry(week)
      };
      try {
        await setDoc(`schedules/${weekId(branch.id, week)}`, data, { stamp: ['updatedAt', 'publishedAt'] });
      } catch (ex) {
        saveMsg().textContent = 'הפרסום לא הצליח. כדאי לנסות שוב.';
        console.error(ex);
        opener?.focus();
        return;
      }
      if (!here()) return;
      await viewBuild(weekParam);
      announce(published ? 'העדכון פורסם' : 'הסידור פורסם');
      document.getElementById('share')?.focus();
    });

    document.getElementById('share')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      try { await shareImage(branch, week, published); } catch (ex) { console.error(ex); announce('לא הצלחנו ליצור תמונה'); }
    }));
  } catch (ex) {
    if (here()) errorState(ex, route.slice(1));
  }
}

/* ---------- branches (main admin) ---------- */

export async function viewBranches() {
  const route = '#/shifts/branches';
  const here = stillAt(route);
  try {
    const g = await gate(route);
    if (!g) return;
    if (!account()?.isAdmin) { location.hash = '#/shifts/manage'; return; }
    const branches = await loadBranches(true);
    const people = await Promise.all(branches.map((b) => list('members', [['branch', '==', b.id]]).catch(() => [])));
    if (!here()) return;
    setPage('סניפים', `
      ${back('#/shifts/manage', 'ניהול סידור')}
      <h1>סניפים</h1>
      ${branches.map((b, i) => {
        const runners = people[i].filter((m) => m.role === 'scheduler' && m.status === 'approved');
        return `<section class="block"><h2>${esc(b.name)}</h2>
          <p>ניהול סידור: ${runners.length ? runners.map((m) => `<bdi>${esc(m.name)}</bdi>`).join(', ') : 'אין עדיין'}. ${plural(people[i].filter((m) => m.status === 'approved').length, 'אדם אחד בצוות', 'אנשים בצוות')}.</p>
          <p class="hint">מינוי לניהול הסידור: במסך "הצוות", תחת "עוד" ליד השם.</p></section>`;
      }).join('')}
      <section class="block"><h2>סניף חדש</h2>
        <form class="name-form" id="new-branch" novalidate>
          <div class="field"><label for="bname">שם הסניף</label><input id="bname" type="text" maxlength="40"></div>
          <div class="field"><label for="bid">מזהה באנגלית</label><p class="hint" id="bid-hint">אותיות קטנות, למשל herzliya</p><input id="bid" type="text" dir="ltr" maxlength="20" aria-describedby="bid-hint"></div>
          <p class="form-err" id="form-err" role="alert"></p>
          <button class="btn" type="submit">הוספה</button>
        </form>
        <p class="hint">סניף חדש מקבל משמרות ושעות ברירת מחדל, וכשיש יותר מסניף אחד, בחירת הסניף מופיעה בהרשמה.</p>
      </section>`);
    const form = document.getElementById('new-branch');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const err = document.getElementById('form-err');
        const name = form.bname.value.replace(/\s+/g, ' ').trim();
        const id = form.bid.value.trim().toLowerCase();
        if (!name || /[<>]/.test(name)) { err.textContent = 'צריך שם לסניף.'; form.bname.focus(); return; }
        if (!/^[a-z][a-z0-9-]{1,19}$/.test(id)) { err.textContent = 'מזהה: 2 עד 20 אותיות קטנות באנגלית, מספרים או מקף.'; form.bid.focus(); return; }
        try { await createBranch(id, { ...DEFAULT_BRANCH, name }); } catch (ex) { err.textContent = 'לא הצלחנו להוסיף (אולי המזהה תפוס).'; console.error(ex); return; }
        if (!here()) return;
        await viewBranches();
        announce('הסניף נוסף');
      });
    });
  } catch (ex) {
    if (here()) errorState(ex, route.slice(1));
  }
}

export { rosette, focusMain };
