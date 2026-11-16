/* Shifts for staff: sign in or sign up, waiting for approval, submitting availability for next week,
   "my shifts" and the published schedule. Or's screens are in manage.js. All text from people
   (names, notes) goes through esc(). */

import { esc, setPage, announce, focusMain, rosette, stillAt } from './core.js';
import {
  cloudEnabled, account, loadMember, cachedMember, isApproved, runsBranch, loadBranches, loadBranch,
  checkUsername, checkDisplayName, checkPassword, signUp, signIn, signOut, authMessage, deleteAccount,
  pendingSignUp, completeSignUp, cacheGet, cachePut, adminRules
} from './account.js';
import { getDoc, setDoc, deleteDoc, list, setWrite, deleteWrite, commit } from './fs.js';
import { installCardHtml, bindInstallCard } from './install.js';
import {
  DAYS, WORK_DAYS, thisWeek, nextWeek, today, addDays, dayDate, short, weekRange, closesAt, deadlineText,
  expiry, slotKey, hoursOf, openSlots, timeRange, weekId, closingSoonText
} from './week.js';
import { shiftsIcs, openIcs } from './calendar.js';


/* ---------- small pieces shared with manage.js ---------- */

export const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
export const loadingHtml = (label = 'בטעינה') => `<div class="loading" aria-hidden="true">${rosette('spin')}</div><p class="sr-only" role="status">${esc(label)}</p>`;

// Sets aria-disabled while an async action runs (a disabled button would drop keyboard focus).
export async function busy(btn, fn) {
  if (btn.getAttribute('aria-disabled') === 'true') return undefined;
  btn.setAttribute('aria-disabled', 'true');
  try { return await fn(); } finally { btn.removeAttribute('aria-disabled'); }
}

export function errorState(ex, retryHash) {
  console.error(ex);
  if (ex && ex.code === 'SIGNED_OUT') return viewShifts();
  const acc = account();
  // 403 before the shifts rules are live in Firebase (launch day): say so instead of "check the connection".
  const notLive = ex && ex.status === 403;
  if (notLive && acc && acc.isAdmin) {
    setPage('משמרות', `
      <div class="state">
        ${rosette()}
        <h1>החשבון נוצר. נשאר להפעיל את המשמרות</h1>
        <p>לוחצים על "העתקת החוקים" למטה, מדביקים אותם במסוף Firebase (Firestore ← Rules), לוחצים Publish, ואז מרעננים את הדף.</p>
      </div>
      ${accountHtml()}`);
    bindAccount();
    document.getElementById('account').open = true;
    return undefined;
  }
  setPage('משמרות', `
    <div class="state">
      ${rosette()}
      <h1>${notLive ? 'המשמרות עוד לא הופעלו' : 'לא הצלחנו לטעון'}</h1>
      <p>${notLive ? 'החשבון נוצר, אבל המערכת עוד בהקמה. כדאי לנסות שוב מאוחר יותר.' : 'כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.'}</p>
      <a class="btn" href="#${esc(retryHash)}" data-retry>לנסות שוב</a>
    </div>
    ${retryHash === '/shifts' ? accountHtml() : ''}`);
  bindAccount();
  document.querySelector('[data-retry]')?.addEventListener('click', (e) => {
    if (location.hash === `#${retryHash}`) { e.preventDefault(); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  });
  return undefined;
}

export const slotLabel = (branch, dow, shift, week) => {
  const h = hoursOf(branch, dow, shift);
  return `${DAYS[dow]}${week ? ` ${short(dayDate(week, dow))}` : ''}, ${shift.name} ${timeRange(h.start, h.end)}`;
};

// Column heads: morning shifts get a sun and a warm color, later ones a moon and a cool color.
const SUN = '<svg class="sh-ico sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg class="sh-ico moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
export const shiftTone = (s) => (String(s.start || '') < '12:00' ? 'am' : 'pm');
export const shiftHead = (s, withHours = true) =>
  `<th scope="col" class="sh-${shiftTone(s)}">${shiftTone(s) === 'am' ? SUN : MOON}${esc(s.name)}${withHours ? `<span class="d">${esc(timeRange(s.start, s.end))}</span>` : ''}</th>`;
// Today's row stands out in every week table.
export const dayRow = (week, dow) => (dayDate(week, dow) === today() ? ' class="today"' : '');
export const todayTag = (week, dow) => (dayDate(week, dow) === today() ? ' <span class="tag today-tag">היום</span>' : '');

// The published schedule as a real table: rows are days, columns are shifts.
export function scheduleTable(branch0, week, sched, myIds = new Set()) {
  const branch = asPublished(branch0, sched);
  const shifts = branch.shifts;
  const changed = new Set(sched.changed || []);
  const rows = WORK_DAYS.map((dow) => {
    const cells = shifts.map((s) => {
      const k = slotKey(dow, s.id);
      const need = Number((sched.need || {})[k] ?? branch.need[k] ?? 0);
      const people = (sched.slots || {})[k] || [];
      if (!need && !people.length) return '<td class="sch-closed">סגור</td>';
      return `<td>${changed.has(k) ? '<span class="tag upd">עודכן</span>' : ''}${people.length ? `<ul class="names">${people.map((p) => {
        const me = myIds.has(p.uid);
        return `<li class="${me ? 'me' : ''}"><bdi>${esc(p.name)}</bdi>${p.start ? ` <span class="start">${esc(p.start)}</span>` : ''}${me ? '<span class="sr-only"> (אני)</span>' : ''}</li>`;
      }).join('')}</ul>` : '<span class="muted">אין שיבוץ</span>'}</td>`;
    }).join('');
    return `<tr${dayRow(week, dow)}><th scope="row">${DAYS[dow]}${todayTag(week, dow)}<span class="d">${short(dayDate(week, dow))}</span></th>${cells}</tr>`;
  }).join('');
  return `
    <div class="sch-wrap">
      <table class="sch">
        <caption>הסידור לשבוע ${weekRange(week)}</caption>
        <thead><tr><td></td>${shifts.map((s) => shiftHead(s)).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// A published week keeps the shift names and hours it was published with.
export const asPublished = (branch, sched) => (sched && sched.shifts ? { ...branch, shifts: sched.shifts, hours: sched.hours || {} } : branch);

// A published week (or null), cached so the home card works offline.
async function loadPublished(branchId, week) {
  try {
    const d = await getDoc(`schedules/${weekId(branchId, week)}`);
    const pub = d && d.status === 'published' ? d : null;
    cachePut(`week.${weekId(branchId, week)}`, pub && { ...pub, publishedAt: pub.publishedAt && pub.publishedAt.toISOString() });
    return pub;
  } catch (e) {
    if (e.code === 'SIGNED_OUT') throw e;
    const c = cacheGet(`week.${weekId(branchId, week)}`);
    if (c) return { ...c, offline: true };
    throw e;
  }
}

const myIdsOf = (member) => new Set([member.uid, ...(member.replaces ? [member.replaces] : [])]);

// My shifts from today on, in this week and next week.
function myShifts(branch0, member, weeks) {
  const ids = myIdsOf(member);
  const from = today();
  const out = [];
  for (const { week, sched } of weeks) {
    if (!sched) continue;
    const branch = asPublished(branch0, sched);
    for (const dow of WORK_DAYS) {
      const date = dayDate(week, dow);
      if (date < from) continue;
      for (const s of branch.shifts) {
        const k = slotKey(dow, s.id);
        const me = ((sched.slots || {})[k] || []).find((p) => ids.has(p.uid));
        if (me) out.push({ date, dow, shift: s, hours: hoursOf(branch, dow, s), start: me.start, changed: (sched.changed || []).includes(k) && (sched.changedFor || []).some((u) => ids.has(u)) });
      }
    }
  }
  return out;
}

const seenKey = (branchId, week) => `seen.${branchId}_${week}`;
const unseenChange = (member, branchId, week, sched) => sched && sched.publishedAt && (sched.changedFor || []).some((u) => myIdsOf(member).has(u))
  && cacheGet(seenKey(branchId, week)) !== new Date(sched.publishedAt).toISOString();
const markSeen = (branchId, week, sched) => { if (sched && sched.publishedAt) cachePut(seenKey(branchId, week), new Date(sched.publishedAt).toISOString()); };

function myShiftsHtml(branch, list) {
  if (!list.length) return '<p class="muted">אין לך משמרות קרובות.</p>';
  return `<ul class="my-shifts">${list.map((x) => {
    const h = x.hours;
    return `<li${x.changed ? ' class="changed"' : ''}><span class="ms-day">${DAYS[x.dow]}, ${short(x.date)}</span><span class="ms-sub">${shiftTone(x.shift) === 'am' ? SUN : MOON}${esc(x.shift.name)}, ${esc(timeRange(h.start, h.end))}${x.start ? `<span class="start"> · התחלה ב־${esc(x.start)}</span>` : ''}${x.changed ? ' <span class="tag upd">עודכן</span>' : ''}</span></li>`;
  }).join('')}</ul>`;
}

/* ---------- the home card ---------- */

// Fills the "המשמרות שלי" card on the home page (quietly does nothing on errors).
const CAL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7 14h4M7 17h7"/></svg>';
// A quiet row at the end of the home page's side column.
const shiftRow = (title, sub) => `<ul class="secondary"><li><a href="#/shifts">${CAL_ICON}<span>${title}<small>${sub}</small></span></a></li></ul>`;

// Home page: the shifts card sits on top only when there is something to see or do (an upcoming
// shift, a change, availability still due); otherwise a quiet row at the end of the column.
export async function homeCard(top, bottom = top) {
  if (!top || !cloudEnabled()) return;
  const put = (el, html) => { top.innerHTML = el === top ? html : ''; if (bottom !== top) bottom.innerHTML = el === bottom ? html : ''; };
  const acc = account();
  if (!acc) { put(bottom, shiftRow('משמרות', 'כניסה או הרשמה, כדי להגיש זמינות ולראות את הסידור')); return; }
  const cm = cachedMember();
  try {
    const member = await loadMember();
    if (!top.isConnected) return;
    if (!member || member.status === 'pending') { put(bottom, shiftRow('המשמרות שלי', 'הבקשה להצטרף עוד ממתינה לאישור.')); return; }
    if (!isApproved(member)) { put(null, ''); return; }
    const branch = await loadBranch(member.branch);
    if (!branch) return;
    const tw = thisWeek(); const nw = nextWeek();
    const [a, b, mine, standing] = await Promise.all([
      loadPublished(branch.id, tw), loadPublished(branch.id, nw),
      getDoc(`availability/${weekId(branch.id, nw)}_${member.uid}`).catch(() => null),
      getDoc(`standing/${member.uid}`).catch(() => null)
    ]);
    if (!top.isConnected) return;
    const all = myShifts(branch, member, [{ week: tw, sched: a }, { week: nw, sched: b }]);
    const list = all.slice(0, 3);
    const changed = unseenChange(member, branch.id, tw, a) || unseenChange(member, branch.id, nw, b);
    const late = Date.now() > closesAt(branch, nw).getTime();
    const due = !b && !mine && !standing && !(late && !branch.lateOk);
    const soon = due && !late ? closingSoonText(branch, nw) : '';
    const availLine = b ? '' : mine || standing ? `<span class="sc-ok">✓ הזמינות לשבוע הבא הוגשה</span>`
      : !due ? ''
      : soon ? `<span class="sc-warn"><strong>תזכורת:</strong> ההגשה לשבוע הבא נסגרת ${soon}, ועוד לא הוגשה זמינות.</span>`
      : `<span class="sc-warn">עוד לא הוגשה זמינות לשבוע הבא. ${late ? 'המועד עבר, אבל אפשר עוד להגיש עד שהסידור יפורסם.' : `אפשר ${esc(deadlineText(branch))}.`}</span>`;
    if (!list.length && !changed && !due) {
      put(bottom, shiftRow('המשמרות שלי', a || b ? 'אין לך משמרות בימים הקרובים.' : 'הסידור עוד לא פורסם.'));
      return;
    }
    put(top, `
      <a class="shift-card${changed ? ' has-change' : ''}" href="#/shifts">
        <span class="sc-title">המשמרות שלי</span>
        ${changed ? '<span class="sc-change">המשמרות שלך השתנו</span>' : ''}
        ${list.length ? `<span class="sc-list">${list.map((x) => {
          const h = x.hours;
          return `<span class="sc-item"><strong>${DAYS[x.dow]}, ${short(x.date)}</strong> ${esc(x.shift.name)}, ${esc(timeRange(x.start || h.start, h.end))}</span>`;
        }).join('')}</span>` : `<span class="sc-sub">${a || b ? 'אין לך משמרות בימים הקרובים.' : 'הסידור עוד לא פורסם.'}</span>`}
        ${availLine}
      </a>`);
  } catch (e) {
    if (top.isConnected && cm && cm.status === 'approved') put(bottom, shiftRow('המשמרות שלי', 'אין חיבור כרגע.'));
  }
}

// "נשארו 3 ימים" / "נשאר יום אחד" / "נשארו 5 שעות", until the deadline.
function timeLeft(at) {
  const ms = at.getTime() - Date.now();
  if (ms < 864e5) { const h = Math.max(1, Math.ceil(ms / 36e5)); return h === 1 ? 'נשארה שעה אחת' : `נשארו ${h} שעות`; }
  const d = Math.ceil(ms / 864e5);
  return d === 1 ? 'נשאר יום אחד' : d === 2 ? 'נשארו יומיים' : `נשארו ${d} ימים`;
}

/* ---------- sign in / sign up ---------- */

// The way from shifts to the menu, flashcards and games.
const MENU_BTN = '<a class="btn ghost btn-wide menu-btn" href="#/">לתפריט ולמשחקים</a>';

const NOTICE_HTML = `
  <ul class="notice">
    <li>נשמרים רק השם בסידור, שם המשתמש, הזמינות וההערות. בלי טלפון ובלי מייל.</li>
    <li>הזמינות, ההערות ובקשות החופש גלויות רק לך, לאור (ניהול הסידור) ולנועם (מנהל המערכת). הסידור שפורסם והשם בטבלת הניקוד גלויים לכל הצוות המאושר.</li>
    <li>המידע נשמר בשרתי Google (Firebase), רק לבניית הסידור, ונמחק אחרי 3 חודשים. השימוש באתר לא חובה: אפשר למסור זמינות לאור ישירות. לתיקון השם פונים לאור, ואת החשבון אפשר למחוק בכל רגע מהמסך הזה.</li>
  </ul>`;

function field(id, label, attrs, hint = '') {
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      ${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ''}
      <input id="${id}" name="${id}" ${attrs} aria-describedby="${hint ? `${id}-hint ` : ''}${id}-err">
      <p class="form-err" id="${id}-err"></p>
    </div>`;
}
const pwField = (id, label, autocomplete) => `
    <div class="field">
      <label for="${id}">${label}</label>
      <div class="pw">
        <input id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" minlength="8" maxlength="100" aria-describedby="${id}-err">
        <button type="button" class="btn ghost pw-show" aria-pressed="false" aria-controls="${id}">הצגה</button>
      </div>
      <p class="form-err" id="${id}-err"></p>
    </div>`;

function authHtml(mode) {
  const isNew = mode === 'new';
  return `
    <h1>משמרות</h1>
    <p>הגשת זמינות, הסידור והמשמרות שלך. התפריט והמשחקים פתוחים גם בלי חשבון.</p>
    <div class="seg" role="group" aria-label="סוג כניסה">
      <button type="button" class="seg-btn" data-mode="in" aria-pressed="${!isNew}">כבר יש לי חשבון</button>
      <button type="button" class="seg-btn" data-mode="new" aria-pressed="${isNew}">חשבון חדש</button>
    </div>
    <form class="name-form auth-form" id="auth-form" novalidate>
      ${isNew ? field('dname', 'שם שיופיע בסידור', 'type="text" maxlength="20" autocomplete="name"', 'שם פרטי ואות ראשונה של שם המשפחה, למשל <bdi class="nw">רוני ל.</bdi>') : ''}
      ${field('uname', 'שם משתמש', 'type="text" maxlength="20" autocomplete="username" autocapitalize="off" spellcheck="false" dir="ltr" inputmode="email"', isNew ? 'באנגלית או מספרים, בלי רווחים. לא צריך מייל.' : '')}
      ${pwField('pw', 'סיסמה', isNew ? 'new-password' : 'current-password')}
      ${isNew ? NOTICE_HTML : '<p class="hint">שכחת סיסמה? אפשר לפתוח חשבון חדש ולבקש מאור לחבר אותו לחשבון הקודם.</p>'}
      <p class="form-err" id="form-err" role="alert"></p>
      <button class="btn btn-wide" type="submit">${isNew ? 'הרשמה' : 'כניסה'}</button>
    </form>`;
}

function bindPasswordToggles(root = document) {
  root.querySelectorAll('.pw-show').forEach((b) => b.addEventListener('click', () => {
    const input = document.getElementById(b.getAttribute('aria-controls'));
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.textContent = show ? 'הסתרה' : 'הצגה';
  }));
}

function viewAuth(mode = 'in') {
  setPage('משמרות', `${mode === 'new' ? installCardHtml({ beforeSignIn: true }) : ''}${authHtml(mode)}${MENU_BTN}`);
  bindInstallCard();
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    viewAuth(b.dataset.mode);
    document.querySelector(`.seg-btn[data-mode="${b.dataset.mode}"]`)?.focus();
  }));
  bindPasswordToggles();
  const form = document.getElementById('auth-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(form.querySelector('[type=submit]'), async () => {
      form.querySelectorAll('.form-err').forEach((p) => { p.textContent = ''; });
      form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
      const errs = [];
      const bad = (id, msg) => { errs.push(id); document.getElementById(`${id}-err`).textContent = msg; document.getElementById(id).setAttribute('aria-invalid', 'true'); };
      let name;
      if (mode === 'new') { const n = checkDisplayName(form.dname.value); if (n.error) bad('dname', n.error); else name = n.name; }
      const u = checkUsername(form.uname.value); if (u.error) bad('uname', u.error);
      const p = mode === 'new' ? checkPassword(form.pw.value) : (form.pw.value ? {} : { error: 'צריך לכתוב סיסמה' });
      if (p.error) bad('pw', p.error);
      if (errs.length) { document.getElementById(errs[0]).focus(); return; }
      try {
        if (mode === 'new') await signUp({ username: u.username, password: form.pw.value, name });
        else await signIn({ username: u.username, password: form.pw.value });
      } catch (ex) {
        document.getElementById('form-err').textContent = authMessage(ex);
        if (ex.code === 'EMAIL_EXISTS') { form.uname.setAttribute('aria-invalid', 'true'); form.uname.focus(); }
        console.error(ex);
        return;
      }
      if (!stillAt('#/shifts')()) return;
      await viewShifts();
      focusMain();
      announce(mode === 'new' ? 'החשבון נוצר' : 'נכנסת לחשבון');
    });
  });
}

/* ---------- the shifts tab ---------- */

function stateScreen(title, text, extra = '') {
  setPage('משמרות', `
    <div class="state">
      ${rosette()}
      <h1>${title}</h1>
      <p>${text}</p>
      ${extra}
    </div>
    ${accountHtml()}`);
  bindAccount();
}

function accountHtml(member) {
  const acc = account();
  if (!acc) return '';
  return `
    <details class="settings" id="account">
      <summary>החשבון שלי</summary>
      <p>${member ? `השם בסידור: <bdi>${esc(member.name)}</bdi><br>` : ''}שם משתמש: <bdi dir="ltr">${esc(acc.username)}</bdi></p>
      <button class="btn ghost" id="sign-out" type="button">יציאה מהחשבון בטלפון הזה</button>
      ${acc.isAdmin ? `<h2>הגדרה ראשונה (ניהול ראשי)</h2>
      <p>מעתיק את חוקי Firestore, כשהחשבון הזה מוגדר בהם לניהול הראשי, להדבקה במסוף Firebase.</p>
      <button class="btn ghost" id="copy-rules" type="button">העתקת החוקים</button>
      <p id="rules-msg" role="status"></p>
      <textarea id="rules-text" class="rules-text" readonly hidden aria-label="חוקי Firestore"></textarea>` : ''}
      <button class="btn btn-no" id="delete-account" type="button">מחיקת החשבון שלי</button>
      <p id="account-msg" role="status"></p>
      <details class="more"><summary>מדיניות פרטיות</summary>${NOTICE_HTML}
        <p>מחיקת החשבון מוחקת גם את הזמינות, בקשות החופש והניקוד. סידורים שכבר פורסמו נמחקים אחרי 3 חודשים.</p></details>
    </details>`;
}

function bindAccount() {
  document.getElementById('copy-rules')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const msg = document.getElementById('rules-msg');
    try {
      const text = await adminRules();
      const box = document.getElementById('rules-text');
      box.value = text;
      try { await navigator.clipboard.writeText(text); msg.textContent = 'החוקים הועתקו. עכשיו מדביקים אותם במסוף Firebase ולוחצים Publish.'; } catch (err) {
        box.hidden = false; box.select(); msg.textContent = 'ההעתקה האוטומטית לא עבדה. החוקים מסומנים בתיבה למטה, אפשר להעתיק ידנית.';
      }
    } catch (ex) { msg.textContent = 'לא הצלחנו לטעון את החוקים.'; console.error(ex); }
  }));
  document.getElementById('sign-out')?.addEventListener('click', () => {
    signOut();
    viewShifts();
    focusMain();
    announce('יצאת מהחשבון');
  });
  document.getElementById('delete-account')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    if (!confirm('למחוק את החשבון? אי אפשר לבטל.')) return;
    try {
      await deleteAccount();
      viewShifts();
      focusMain();
      announce('החשבון נמחק');
    } catch (ex) {
      document.getElementById('account-msg').textContent = 'המחיקה לא הצליחה. כדאי לנסות שוב בעוד רגע.';
      console.error(ex);
    }
  }));
}

// Picking a branch, when there is more than one (or the record wasn't saved after signing up).
async function viewFinishSignUp() {
  const branches = await loadBranches(true);
  const p = pendingSignUp() || {};
  if (!branches.length) {
    stateScreen('ההרשמה כמעט הושלמה', 'המערכת עוד לא נפתחה לסניף. כדאי לנסות שוב מאוחר יותר.', '<a class="btn" href="#/shifts" id="again">לנסות שוב</a>');
    document.getElementById('again').addEventListener('click', (e) => { e.preventDefault(); viewShifts(); });
    return;
  }
  setPage('משמרות', `
    <h1>עוד צעד אחד</h1>
    <form class="name-form" id="finish-form" novalidate>
      ${field('dname', 'שם שיופיע בסידור', `type="text" maxlength="20" autocomplete="name" value="${esc(p.name || '')}"`, 'שם פרטי ואות ראשונה של שם המשפחה, למשל <bdi class="nw">רוני ל.</bdi>')}
      <div class="field">
        <label for="branch">סניף</label>
        <select id="branch" name="branch">${branches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select>
      </div>
      <p class="form-err" id="form-err" role="alert"></p>
      <button class="btn btn-wide" type="submit">שליחת הבקשה</button>
    </form>
    ${accountHtml()}`);
  bindAccount();
  const form = document.getElementById('finish-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(form.querySelector('[type=submit]'), async () => {
      const n = checkDisplayName(form.dname.value);
      if (n.error) { document.getElementById('dname-err').textContent = n.error; form.dname.setAttribute('aria-invalid', 'true'); form.dname.focus(); return; }
      try {
        await completeSignUp(n.name, form.branch.value);
        await viewShifts();
        focusMain();
      } catch (ex) {
        document.getElementById('form-err').textContent = 'לא הצלחנו לשלוח. כדאי לנסות שוב בעוד רגע.';
        console.error(ex);
      }
    });
  });
}

export async function viewShifts() {
  if (!cloudEnabled()) {
    setPage('משמרות', '<h1>משמרות</h1><p>המשמרות ייפתחו כאן בקרוב.</p>');
    return;
  }
  if (!account()) { viewAuth('in'); return; }
  const here = stillAt(location.hash || '#/shifts');
  setPage('משמרות', `<h1 class="sr-only">משמרות</h1>${loadingHtml()}`);
  let member;
  try {
    member = await loadMember(true);
  } catch (ex) {
    if (ex.code === 'SIGNED_OUT') { if (here()) viewAuth('in'); return; }
    if (here()) errorState(ex, '/shifts');
    return;
  }
  if (!here()) return;
  if (!member) { await viewFinishSignUp().catch((ex) => errorState(ex, '/shifts')); return; }
  if (member.status === 'pending') {
    stateScreen('הבקשה נשלחה לאור', 'כשהבקשה תאושר, המשמרות ייפתחו כאן. בינתיים התפריט והמשחקים פתוחים כרגיל.',
      `<a class="btn ghost" href="#/shifts" id="again">בדיקה אם הבקשה אושרה</a>${MENU_BTN}${installCardHtml()}`);
    bindInstallCard();
    document.getElementById('again').addEventListener('click', (e) => { e.preventDefault(); viewShifts(); });
    return;
  }
  if (member.status !== 'approved') {
    stateScreen('החשבון הזה לא פעיל', 'אם זו טעות, כדאי לדבר עם אור.');
    return;
  }
  try {
    await viewHub(member, here);
  } catch (ex) {
    if (here()) errorState(ex, '/shifts');
  }
}

async function viewHub(member, here) {
  const branch = await loadBranch(member.branch);
  if (!branch) { stateScreen('הסניף לא נמצא', 'כדאי לדבר עם אור.'); return; }
  const tw = thisWeek(); const nw = nextWeek();
  const [a, b, mine, standing, waiting] = await Promise.all([
    loadPublished(branch.id, tw), loadPublished(branch.id, nw),
    getDoc(`availability/${weekId(branch.id, nw)}_${member.uid}`),
    getDoc(`standing/${member.uid}`),
    // Whoever runs the branch sees new join requests right here.
    runsBranch(member) ? list('members', [['branch', '==', branch.id], ['status', '==', 'pending']], { limit: 100 }).catch(() => []) : []
  ]);
  if (!here()) return;
  const mineList = myShifts(branch, member, [{ week: tw, sched: a }, { week: nw, sched: b }]);
  const changed = unseenChange(member, branch.id, tw, a) || unseenChange(member, branch.id, nw, b);
  const marked = mineList.some((x) => x.changed);
  const closeAt = closesAt(branch, nw);
  const late = Date.now() > closeAt.getTime();
  let availCard;
  if (b) {
    availCard = '<p>הסידור לשבוע הבא פורסם, וההגשה נסגרה.</p>';
  } else {
    // One bar that says where things stand: orange until submitted, green after, grey once closed.
    const can = !late || branch.lateOk;
    const range = weekRange(nw);
    let bar;
    if (mine || standing) {
      bar = `<p class="bar bar-ok" role="status">${mine ? `✓ הגשת זמינות לשבוע ${range}` : `✓ הזמינות הקבועה שלך תיכנס לשבוע ${range}`}</p>
        ${can ? '<p><a href="#/shifts/avail">לשינוי</a></p>' : ''}`;
    } else if (can) {
      bar = `<p class="bar bar-warn" role="status">${late ? 'המועד עבר, אבל אפשר עוד להגיש עד שהסידור יפורסם' : `${timeLeft(closeAt)} להגיש זמינות לשבוע ${range}`}</p>
        ${late ? '' : `<p class="hint">אפשר להגיש ולשנות ${esc(deadlineText(branch))}.</p>`}
        <a class="btn ok btn-wide" href="#/shifts/avail">להגשת זמינות</a>`;
    } else {
      bar = '<p class="bar bar-closed" role="status">ההגשה נסגרה. הסידור יפורסם בקרוב.</p>';
    }
    availCard = bar;
  }
  setPage('משמרות', `
    <h1>משמרות</h1>
    ${installCardHtml()}
    ${a && a.offline ? '<p class="note">אין חיבור. מוצג הסידור שנשמר בטלפון.</p>' : ''}
    ${waiting.length ? `<a class="row-link manage-link join-link" href="#/shifts/people"><span class="row-title">${waiting.length === 1 ? 'בקשת הצטרפות אחת מחכה לאישור' : `${waiting.length} בקשות הצטרפות מחכות לאישור`}</span><span aria-hidden="true">←</span></a>` : ''}
    ${runsBranch(member) ? '<a class="row-link manage-link" href="#/shifts/manage"><span class="row-title">ניהול סידור</span><span aria-hidden="true">←</span></a>' : ''}
    <section aria-labelledby="mine-h" class="block">
      <h2 id="mine-h">המשמרות שלי</h2>
      ${changed ? `<p class="change-line" role="status">המשמרות שלך השתנו מאז הפעם הקודמת.${marked ? ' השינויים מסומנים "עודכן".' : ''}</p>` : ''}
      ${a || b ? myShiftsHtml(branch, mineList) : '<p class="muted">הסידור עוד לא פורסם.</p>'}
      ${mineList.length ? '<button class="btn ghost small" type="button" id="to-cal">הוספה ליומן בטלפון</button>' : ''}
    </section>
    ${MENU_BTN}
    <section aria-labelledby="avail-h" class="block">
      <h2 id="avail-h">זמינות לשבוע הבא</h2>
      ${availCard}
      <p><a href="#/shifts/off">בקשת חופש לתאריך</a></p>
    </section>
    ${a ? `<section class="block">${scheduleTable(branch, tw, a, myIdsOf(member))}</section>` : ''}
    ${b ? `<section class="block">${scheduleTable(branch, nw, b, myIdsOf(member))}</section>` : ''}
    ${!b ? `<p class="hint">הסידור לשבוע הבא יתפרסם ביום ${DAYS[branch.publishDow]}.</p>` : ''}
    <p><a href="#/team">טבלת הצוות</a></p>
    ${accountHtml(member)}
  `);
  bindAccount();
  bindInstallCard();
  document.getElementById('to-cal')?.addEventListener('click', () => {
    openIcs(shiftsIcs(mineList, member.uid, `לאר דו פאן ${branch.name || ''}`.trim()), 'lardo-shifts.ics');
    announce('קובץ היומן נוצר. פותחים אותו ומאשרים הוספה ליומן.');
  });
  markSeen(branch.id, tw, a);
  markSeen(branch.id, nw, b);
}

/* ---------- availability ---------- */

// Used by the employee (self) and by the scheduler for someone (manage.js passes `forMember`).
export async function viewAvailability(forMember = null) {
  const route = location.hash;
  const here = stillAt(route);
  setPage('הגשת זמינות', `<h1 class="sr-only">הגשת זמינות</h1>${loadingHtml()}`);
  try {
    const me = await loadMember();
    if (!here()) return;
    if (!isApproved(me)) { viewShifts(); return; }
    const who = forMember || me;
    const byManager = Boolean(forMember);
    const branch = await loadBranch(who.branch);
    const week = nextWeek();
    const [doc, standing, wk] = await Promise.all([
      getDoc(`availability/${weekId(branch.id, week)}_${who.uid}`),
      getDoc(`standing/${who.uid}`),
      getDoc(`schedules/${weekId(branch.id, week)}`)
    ]);
    if (!here()) return;
    const published = wk && wk.status === 'published';
    const deadline = (wk && wk.closesAt) || closesAt(branch, week);
    const late = Date.now() > deadline.getTime();
    const locked = !byManager && (published || (late && !branch.lateOk));
    const slots = new Set(doc ? doc.slots : standing ? standing.slots : []);
    const note = doc ? doc.note : standing ? (standing.note || '') : '';
    const back = byManager ? '#/shifts/people' : '#/shifts';
    const open = openSlots(branch);
    const openKeys = new Set(open.map((s) => s.key));

    const rows = WORK_DAYS.map((dow) => `
      <tr${dayRow(week, dow)}><th scope="row">${DAYS[dow]}${todayTag(week, dow)}<span class="d">${short(dayDate(week, dow))}</span></th>
      ${branch.shifts.map((s) => {
        const k = slotKey(dow, s.id);
        if (!openKeys.has(k)) return '<td class="av-closed">סגור</td>';
        const on = slots.has(k);
        return `<td><button type="button" class="av-btn" data-k="${k}" aria-pressed="${on}" aria-label="${esc(slotLabel(branch, dow, s, week))}"${locked ? ' aria-disabled="true"' : ''}>${on ? '✓ אפשר' : ''}</button></td>`;
      }).join('')}</tr>`).join('');

    setPage('הגשת זמינות', `
      <a class="back" href="${back}"><span aria-hidden="true">→</span> ${byManager ? 'הצוות' : 'משמרות'}</a>
      <h1>${byManager ? `זמינות של ${esc(who.name)}` : 'מתי אפשר לשבץ אותך?'}</h1>
      <p class="sub">שבוע ${weekRange(week)}</p>
      ${published && !byManager ? '<p class="note">הסידור לשבוע הזה כבר פורסם, וההגשה נסגרה.</p>' : ''}
      ${!published && late && !byManager ? (branch.lateOk ? '<p class="note">המועד עבר, אבל אפשר עוד להגיש עד שהסידור יפורסם. ההגשה תסומן כמאוחרת.</p>' : '<p class="note">ההגשה נסגרה. אחרי המועד, שינויים רק דרך ניהול הסידור.</p>') : ''}
      ${!late && !byManager ? `<p class="hint">אפשר לשנות ${esc(deadlineText(branch))}. משמרת שלא סומנה נחשבת "אי אפשר".</p>` : ''}
      ${!doc && standing ? '<p class="hint">מולא מהזמינות הקבועה שלך. אפשר לשנות.</p>' : ''}
      <form id="avail-form" novalidate>
        <div class="sch-wrap">
          <table class="sch av">
            <caption class="sr-only">זמינות לשבוע ${weekRange(week)}</caption>
            <thead><tr><td></td>${branch.shifts.map((s) => shiftHead(s)).join('')}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="hint" id="count" aria-live="polite"></p>
        <div class="field">
          <label for="note">הערה לאור (לא חובה)</label>
          <p class="hint" id="note-hint">אין צורך לכתוב סיבה.</p>
          <input id="note" name="note" type="text" maxlength="100" value="${esc(note)}" placeholder="למשל: עד 14:00" aria-describedby="note-hint"${locked ? ' readonly' : ''}>
        </div>
        ${byManager ? '' : `<label class="toggle-row"><input type="checkbox" id="keep"${standing ? ' checked' : ''}${locked ? ' disabled' : ''}> לשמור גם לשבועות הבאים</label>
        <p class="hint">כשמסומן, הזמינות הזו תיכנס לבד לכל שבוע עד שמשנים אותה.</p>`}
        <p class="form-err" id="form-err" role="alert"></p>
        ${locked ? '' : `<button class="btn ok btn-wide" type="submit">${byManager ? 'שמירה' : 'שליחה'}</button>`}
      </form>`);

    const count = () => {
      const n = document.querySelectorAll('.av-btn[aria-pressed="true"]').length;
      document.getElementById('count').textContent = n === 1 ? 'סומנה משמרת אחת.' : n ? `סומנו ${n} משמרות.` : 'עוד לא סומנה אף משמרת.';
    };
    count();
    document.querySelectorAll('.av-btn').forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? '✓ אפשר' : '';
      count();
      dirty = true;
    }));
    const form = document.getElementById('avail-form');
    // Taps that weren't sent yet: ask before leaving (links, tabs, closing the page).
    let dirty = false;
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('change', () => { dirty = true; });
    const LEAVE = 'הזמינות עוד לא נשלחה. לצאת בלי לשלוח?';
    const onLink = (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!dirty || !a || !here()) return;
      if (!confirm(LEAVE)) { e.preventDefault(); e.stopPropagation(); } else dirty = false;
    };
    const onUnload = (e) => { if (dirty && here()) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('click', onLink, true);
    window.addEventListener('beforeunload', onUnload);
    const stop = () => { if (here()) return; document.removeEventListener('click', onLink, true); window.removeEventListener('beforeunload', onUnload); window.removeEventListener('hashchange', stop); };
    window.addEventListener('hashchange', stop);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const chosen = [...document.querySelectorAll('.av-btn[aria-pressed="true"]')].map((b) => b.dataset.k);
        const text = form.note.value.replace(/\s+/g, ' ').trim().slice(0, 100);
        const data = { branch: branch.id, week, uid: who.uid, name: who.name, slots: chosen, note: text, expireAt: expiry(week), by: byManager ? 'manager' : 'self' };
        const writes = [setWrite(`availability/${weekId(branch.id, week)}_${who.uid}`, data, { stamp: ['updatedAt'] })];
        try {
          await commit(writes);
          if (!byManager) {
            const keep = document.getElementById('keep').checked;
            if (keep) await setDoc(`standing/${who.uid}`, { branch: branch.id, uid: who.uid, name: who.name, slots: chosen, note: text }, { stamp: ['updatedAt'] });
            else if (standing) await deleteDoc(`standing/${who.uid}`);
          }
        } catch (ex) {
          document.getElementById('form-err').textContent = ex.status === 403
            ? 'ההגשה נסגרה בינתיים. לשינוי פונים לניהול הסידור.'
            : 'לא הצלחנו לשמור. כדאי לבדוק את החיבור ולנסות שוב.';
          console.error(ex);
          return;
        }
        if (!here()) return;
        dirty = false;
        location.hash = back;
        announce(byManager ? 'הזמינות נשמרה' : `הזמינות הוגשה. אפשר לשנות ${deadlineText(branch)}.`);
      });
    });
  } catch (ex) {
    if (here()) errorState(ex, route.slice(1));
  }
}

/* ---------- time off ---------- */

export async function viewTimeOff() {
  const here = stillAt('#/shifts/off');
  setPage('בקשת חופש', `<h1 class="sr-only">בקשת חופש</h1>${loadingHtml()}`);
  try {
    const me = await loadMember();
    if (!here()) return;
    if (!isApproved(me)) { viewShifts(); return; }
    const mine = (await list('timeoff', [['uid', '==', me.uid]])).sort((x, y) => x.from.localeCompare(y.from));
    if (!here()) return;
    const min = today();
    const max = addDays(min, 90);
    setPage('בקשת חופש', `
      <a class="back" href="#/shifts"><span aria-hidden="true">→</span> משמרות</a>
      <h1>בקשת חופש</h1>
      <p>הבקשה מגיעה לאור, שמתחשב בה כשהסידור נבנה. אין צורך לכתוב סיבה.</p>
      <form class="name-form" id="off-form" novalidate>
        <div class="field"><label for="from">מתאריך</label><input id="from" name="from" type="date" min="${min}" max="${max}" required></div>
        <div class="field"><label for="to">עד תאריך (כולל)</label><input id="to" name="to" type="date" min="${min}" max="${addDays(max, 60)}"></div>
        <div class="field"><label for="onote">הערה (לא חובה)</label><input id="onote" name="onote" type="text" maxlength="100" placeholder="למשל: רק בבוקר"></div>
        <p class="form-err" id="form-err" role="alert"></p>
        <button class="btn btn-wide" type="submit">שליחת הבקשה</button>
      </form>
      ${mine.length ? `<h2>הבקשות שלי</h2><ul class="plain-list">${mine.map((o) => `
        <li><span>${short(o.from)}${o.to !== o.from ? `–${short(o.to)}` : ''}${o.note ? `: <bdi>${esc(o.note)}</bdi>` : ''}</span>
        <button class="btn ghost small" type="button" data-del="${esc(o.id)}" aria-label="ביטול הבקשה ל־${short(o.from)}">ביטול</button></li>`).join('')}</ul>` : ''}
    `);
    const form = document.getElementById('off-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const from = form.from.value; const to = form.to.value || from;
        const err = document.getElementById('form-err');
        if (!from || from < min || from > max) { err.textContent = 'צריך לבחור תאריך מהיום ועד 3 חודשים קדימה.'; form.from.focus(); return; }
        if (to < from) { err.textContent = 'תאריך הסיום לפני תאריך ההתחלה.'; form.to.focus(); return; }
        if (to > addDays(from, 60)) { err.textContent = 'בקשה אחת יכולה להיות עד 60 יום. לתקופה ארוכה יותר כדאי לדבר עם הניהול.'; form.to.focus(); return; }
        if (mine.some((o) => o.from === from)) { err.textContent = 'כבר יש בקשה שמתחילה בתאריך הזה. אפשר לבטל אותה ולשלוח חדשה.'; form.from.focus(); return; }
        const id = `${me.uid}_${from}`; // one request per start day (the rules check this)
        try {
          await setDoc(`timeoff/${id}`, { branch: me.branch, uid: me.uid, name: me.name, from, to, note: form.onote.value.replace(/\s+/g, ' ').trim().slice(0, 100), expireAt: expiry(addDays(to, -7)) }, { stamp: ['createdAt'] });
        } catch (ex) { err.textContent = 'לא הצלחנו לשלוח. כדאי לנסות שוב.'; console.error(ex); return; }
        if (!here()) return;
        await viewTimeOff();
        announce('הבקשה נשלחה');
      });
    });
    document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      try { await deleteDoc(`timeoff/${b.dataset.del}`); } catch (ex) { console.error(ex); return; }
      if (!here()) return;
      await viewTimeOff();
      announce('הבקשה בוטלה');
    })));
  } catch (ex) {
    if (here()) errorState(ex, '/shifts/off');
  }
}

export { deleteWrite };
