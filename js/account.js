/* Staff accounts: username + password (stored by Firebase Auth, never here), one member record per
   account that the branch's scheduler approves. The username becomes an internal address that
   can't receive mail (<username>@staff.lardo.invalid). An account from the old nickname board is
   upgraded in place, so its uid and score stay. */

import {
  cloudEnabled, authState, setAuth, passwordSignUp, passwordSignIn, authCall, token,
  getDoc, setDoc, setWrite, deleteWrite, commit, list, readJson, writeJson
} from './fs.js';

export const ADMIN_USERNAME = 'noam';
const DOMAIN = 'staff.lardo.invalid';
const MEMBER_KEY = 'lardo.member.v1';   // last known member record, so the home card shows offline
const PENDING_KEY = 'lardo.signup.v1';  // a sign-up whose member record couldn't be saved yet
const CACHE_PREFIX = 'lardo.shifts.';    // cached schedules (cleared on sign-out)

export const emailOf = (username) => `${username}@${DOMAIN}`;
export const usernameOf = (email) => (email && email.endsWith(`@${DOMAIN}`) ? email.split('@')[0] : null);

/* ---------- checks shared with firestore.rules ---------- */

export function checkUsername(raw) {
  const u = String(raw || '').trim().toLowerCase();
  if (!u) return { error: 'צריך לבחור שם משתמש' };
  if (!/^[a-z0-9][a-z0-9._-]{1,19}$/.test(u)) return { error: 'שם משתמש: 2 עד 20 אותיות באנגלית או מספרים (אפשר גם . _ -)' };
  return { username: u };
}
// Control, zero-width, bidi and line-separator characters, and < > / (same list as firestore.rules validName).
const BAD_RANGES = [[0x0, 0x1f], [0x7f, 0x7f], [0xad, 0xad], [0x61c, 0x61c], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]];
const BAD_CHARS = new RegExp(`[${BAD_RANGES.map(([x, y]) => `${String.fromCharCode(x)}-${String.fromCharCode(y)}`).join('')}<>/]`);
export function checkDisplayName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'צריך לכתוב שם לסידור' };
  if (name.length > 20) return { error: 'אפשר עד 20 תווים' };
  if (BAD_CHARS.test(name)) return { error: 'יש בשם תו שאי אפשר להשתמש בו' };
  return { name };
}
export const checkPassword = (p) => (String(p || '').length >= 8 ? {} : { error: 'סיסמה של 8 תווים לפחות' });

/* ---------- session ---------- */

// { uid, username, isAdmin } for a staff account; null when signed out or on an old anonymous account.
export function account() {
  const a = authState();
  const username = a && usernameOf(a.email);
  return username ? { uid: a.uid, username, isAdmin: username === ADMIN_USERNAME } : null;
}
// The old nickname board's anonymous account (no username yet).
export const anonymousAccount = () => { const a = authState(); return a && !a.email ? a : null; };

export const cachedMember = () => {
  const m = readJson(MEMBER_KEY);
  const acc = account();
  return m && acc && m.uid === acc.uid ? m : null;
};

let memberPromise = null;
// The member record, fresh from the server once per page load (or on demand). null = no record.
export function loadMember(force = false) {
  if (!force && memberPromise) return memberPromise;
  memberPromise = (async () => {
    const acc = account();
    if (!acc) return null;
    await finishPendingSignUp();
    let m = await getDoc(`members/${acc.uid}`);
    if (m && m.status === 'pending' && acc.isAdmin) { await approveSelf(); m = await getDoc(`members/${acc.uid}`); }
    const rec = m ? { ...m, uid: acc.uid } : null;
    // Someone disabled or removed: drop the schedules saved on this phone.
    if (!rec || rec.status === 'disabled') clearCache();
    writeJson(MEMBER_KEY, rec && { uid: rec.uid, name: rec.name, branch: rec.branch, role: rec.role, status: rec.status, replaces: rec.replaces });
    return rec;
  })();
  memberPromise.catch(() => { memberPromise = null; });
  return memberPromise;
}

export const isApproved = (m) => Boolean(m && m.status === 'approved');
export const runsBranch = (m) => Boolean(m && m.status === 'approved' && (m.role === 'scheduler' || account()?.isAdmin));

/* ---------- branches ---------- */

let branchesPromise = null;
export function loadBranches(force = false) {
  if (!force && branchesPromise) return branchesPromise;
  branchesPromise = list('branches', [], { limit: 50 }).then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name, 'he')));
  branchesPromise.catch(() => { branchesPromise = null; });
  return branchesPromise;
}
export async function loadBranch(id) {
  const all = await loadBranches();
  return all.find((b) => b.id === id) || null;
}
export const forgetBranches = () => { branchesPromise = null; };

/* ---------- sign up / sign in / out ---------- */

const AUTH_ERRORS = {
  EMAIL_EXISTS: 'שם המשתמש הזה כבר תפוס. אפשר לבחור אחר, או להיכנס אם זה החשבון שלך.',
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'צריך להיכנס מחדש ולנסות שוב.',
  INVALID_LOGIN_CREDENTIALS: 'שם המשתמש או הסיסמה לא נכונים.',
  INVALID_PASSWORD: 'שם המשתמש או הסיסמה לא נכונים.',
  EMAIL_NOT_FOUND: 'שם המשתמש או הסיסמה לא נכונים.',
  USER_DISABLED: 'החשבון הזה חסום.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'יותר מדי ניסיונות. כדאי לחכות כמה דקות ולנסות שוב.',
  WEAK_PASSWORD: 'הסיסמה חלשה מדי. צריך 8 תווים לפחות.',
  OPERATION_NOT_ALLOWED: 'ההרשמה עוד לא פתוחה.'
};
export const authMessage = (e) => AUTH_ERRORS[e && e.code] || 'לא הצלחנו להתחבר. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.';

function memberData(acc, name, branch) {
  return { name, username: acc.username, branch, role: 'staff', status: 'pending' };
}
// The main admin approves their own record (the rules know the admin by uid; for anyone else this is refused).
const approveSelf = () => setDoc(`members/${account().uid}`, { status: 'approved' }, { mask: ['status'], stamp: ['updatedAt'] }).catch(() => {});

// A new branch with placeholder hours and staffing; the scheduler edits them in the settings.
export const DEFAULT_BRANCH = {
  name: 'רעננה', active: true, closeDow: 3, closeMin: 1440, publishDow: 5, lateOk: true,
  shifts: [{ id: 'm', name: 'בוקר', start: '06:30', end: '14:30' }, { id: 'e', name: 'ערב', start: '14:00', end: '20:30' }],
  need: { '0m': 2, '0e': 2, '1m': 2, '1e': 2, '2m': 2, '2e': 2, '3m': 2, '3e': 2, '4m': 2, '4e': 2, '5m': 3, '5e': 0 },
  hours: { '5m': '06:30-15:00' }
};
export async function createBranch(id, data) {
  await setDoc(`branches/${id}`, data, { stamp: ['updatedAt'], exists: false });
  forgetBranches();
}

// Saves the member record of a sign-up: right away, or later if it couldn't be saved then
// (offline, or before the new rules went live). With one branch it is picked automatically.
async function finishPendingSignUp() {
  const p = readJson(PENDING_KEY);
  const acc = account();
  if (!p || !acc || p.uid !== acc.uid) return;
  try {
    let branch = p.branch;
    if (!branch) {
      let branches = await loadBranches(true);
      if (!branches.length && acc.isAdmin) { await createBranch('raanana', DEFAULT_BRANCH); branches = await loadBranches(true); }
      if (branches.length !== 1) return; // the person picks one (or there is none yet)
      branch = branches[0].id;
    }
    await setDoc(`members/${acc.uid}`, memberData(acc, p.name, branch), { stamp: ['createdAt'], exists: false });
    if (acc.isAdmin) await approveSelf();
  } catch (e) {
    if (e.status !== 409 && !/exist/i.test(e.message)) return; // try again next time
  }
  writeJson(PENDING_KEY, null);
}
export const pendingSignUp = () => { const p = readJson(PENDING_KEY); const acc = account(); return p && acc && p.uid === acc.uid ? p : null; };

// The last step when there is more than one branch (or the record wasn't saved).
export async function completeSignUp(name, branch) {
  const acc = account();
  writeJson(PENDING_KEY, { uid: acc.uid, name, branch });
  memberPromise = null;
  await finishPendingSignUp();
  if (pendingSignUp()) throw new Error('not saved');
}

export async function signUp({ username, password, name }) {
  const anon = anonymousAccount();
  let anonToken;
  if (anon) { try { anonToken = (await token()).idToken; } catch (e) { anonToken = undefined; } }
  try {
    await passwordSignUp(emailOf(username), password, anonToken);
  } catch (e) {
    // The old anonymous account is gone on the server: make a fresh account instead.
    if (anonToken && (e.code === 'USER_NOT_FOUND' || e.code === 'INVALID_ID_TOKEN' || e.code === 'TOKEN_EXPIRED')) {
      await passwordSignUp(emailOf(username), password);
    } else throw e;
  }
  const acc = account();
  writeJson(PENDING_KEY, { uid: acc.uid, name, branch: null });
  memberPromise = null;
  await finishPendingSignUp();
  return acc;
}

export async function signIn({ username, password }) {
  await passwordSignIn(emailOf(username), password);
  memberPromise = null;
  return account();
}

// Forgets the account on this phone, with everything cached from the shifts.
export function signOut() {
  setAuth(null);
  writeJson(MEMBER_KEY, null);
  writeJson(PENDING_KEY, null);
  memberPromise = null;
  clearCache();
}
function clearCache() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX) || k === 'lardo.player.v1').forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* nothing cached */ }
}

// For the main admin's first setup: the rules file with this account's uid filled in, ready to paste
// into the Firebase console.
export async function adminRules() {
  const acc = account();
  const res = await fetch('firestore.rules', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('__ADMIN_UID__')) throw new Error('no placeholder');
  return text.replace('__ADMIN_UID__', acc.uid);
}

export const cacheGet = (k) => readJson(CACHE_PREFIX + k);
export const cachePut = (k, v) => writeJson(CACHE_PREFIX + k, v);

// Deletes everything that belongs to this account, then the account itself.
export async function deleteAccount() {
  const acc = account();
  if (!acc) return;
  const m = await getDoc(`members/${acc.uid}`).catch(() => null);
  const approved = m && m.status === 'approved';
  const writes = [];
  if (approved) {
    const [av, off, daily] = await Promise.all([
      list('availability', [['uid', '==', acc.uid]]),
      list('timeoff', [['uid', '==', acc.uid]]),
      list('daily', [['uid', '==', acc.uid]], { limit: 400 })
    ]);
    av.forEach((d) => writes.push(deleteWrite(`availability/${d.id}`)));
    off.forEach((d) => writes.push(deleteWrite(`timeoff/${d.id}`)));
    daily.forEach((d) => writes.push(deleteWrite(`daily/${d.id}`)));
    writes.push(deleteWrite(`standing/${acc.uid}`), deleteWrite(`players/${acc.uid}`), deleteWrite(`progress/${acc.uid}`));
  }
  // One write at a time: a week that is already closed refuses only its own delete.
  await Promise.allSettled(writes.map((w) => commit([w])));
  if (m) await commit([deleteWrite(`members/${acc.uid}`)]);
  const a = await token();
  await authCall('delete', { idToken: a.idToken }).catch(() => { /* already gone */ });
  signOut();
}

export { cloudEnabled, setWrite };
