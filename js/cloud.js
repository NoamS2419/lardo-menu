/* Team leaderboard over Firebase REST (no SDK, so the CSP stays 'self').
   Anonymous sign-in, a nickname, a running total from game answers and one daily-challenge score.
   Rules live in firestore.rules; names are rendered with esc() only. */

import { FIREBASE, TEAM_PROGRESS } from './config.js';
import { db } from './core.js';
import { teamStats, progress } from './progress.js';

const AUTH_KEY = 'lardo.auth.v1';
const PLAYER_KEY = 'lardo.player.v1';
const DAILY_TTL_DAYS = 60;

export const cloudEnabled = () => Boolean(FIREBASE.apiKey && FIREBASE.projectId);
export const teamProgressEnabled = () => cloudEnabled() && TEAM_PROGRESS;

const docsBase = () =>
  `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents`;
const docName = (path) =>
  `projects/${FIREBASE.projectId}/databases/(default)/documents/${path}`;

/* ---------- local storage (best effort) ---------- */

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)) || null; } catch (e) { return null; }
}
function writeJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* not saved */ }
}

/* ---------- nickname ---------- */

export const myPlayer = () => {
  const p = readJson(PLAYER_KEY);
  return p && typeof p.name === 'string' && typeof p.key === 'string' ? p : null;
};

// Same rule as firestore.rules validName: 1-20 chars, trimmed, single spaces,
// no control, zero-width, bidi or line-separator characters, no < > or /.
const BAD_CHARS = /[\u0000-\u001F\u007F\u00AD\u061C\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF<>/]/;
export function checkName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'צריך לכתוב שם או כינוי' };
  if (name.length > 20) return { error: 'אפשר עד 20 תווים.' };
  if (BAD_CHARS.test(name)) return { error: 'יש בשם תו שאי אפשר להשתמש בו' };
  if (/^\.+$/.test(name) || /^__.*__$/.test(name)) return { error: 'יש בשם תו שאי אפשר להשתמש בו' };
  return { name, key: name.toLowerCase() };
}

/* ---------- auth ---------- */

async function postJson(url, body, token) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    referrerPolicy: 'strict-origin' // the API key is restricted by referrer
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && (data.error.message || data.error.status)) || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.error && data.error.status;
    throw err;
  }
  return data;
}

async function token() {
  let a = readJson(AUTH_KEY);
  const now = Date.now();
  if (a && a.idToken && a.exp > now + 60000) return a;
  if (a && a.refreshToken) {
    let r;
    try {
      r = await postJson(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE.apiKey}`,
        { grant_type: 'refresh_token', refresh_token: a.refreshToken });
    } catch (e) {
      // Account deleted or token revoked: forget it and start over with a new nickname.
      if (e.status === 400 || e.status === 401 || e.status === 403) {
        writeJson(AUTH_KEY, null);
        writeJson(PLAYER_KEY, null);
        e.code = 'RESET';
      }
      throw e;
    }
    a = { uid: r.user_id, idToken: r.id_token, refreshToken: r.refresh_token, exp: now + Number(r.expires_in) * 1000 };
  } else {
    const r = await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`,
      { returnSecureToken: true });
    a = { uid: r.localId, idToken: r.idToken, refreshToken: r.refreshToken, exp: now + Number(r.expiresIn) * 1000 };
  }
  writeJson(AUTH_KEY, a);
  return a;
}

/* ---------- Firestore REST helpers ---------- */

const str = (v) => ({ stringValue: String(v) });
const int = (v) => ({ integerValue: String(Math.max(0, Math.floor(v))) });

function decode(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = 'integerValue' in v ? Number(v.integerValue)
      : 'stringValue' in v ? v.stringValue
      : 'timestampValue' in v ? v.timestampValue
      : 'booleanValue' in v ? v.booleanValue
      : null;
  }
  return out;
}

async function commit(writes) {
  const a = await token();
  return postJson(`${docsBase()}:commit`, { writes }, a.idToken);
}

async function query(structuredQuery) {
  const a = await token();
  const rows = await postJson(`${docsBase()}:runQuery`, { structuredQuery }, a.idToken);
  return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), ...decode(r.document.fields) }));
}

const extraFields = () => {
  if (!TEAM_PROGRESS || !db || !progress.shareProgress) return {}; // the write replaces the doc, so switching off removes them
  const t = teamStats(db.categories, db.byCat);
  return { onboarded: { booleanValue: t.onboarded }, known: str(t.known) };
};

const playerWrite = (uid, name, key, total) => ({
  update: { name: docName(`players/${uid}`), fields: { name: str(name), nameKey: str(key), total: int(total), ...extraFields() } },
  updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }]
});

/* ---------- public API ---------- */

// Claims a nickname (unique across the team) and publishes the current total.
export async function claimName(raw, total) {
  const checked = checkName(raw);
  if (checked.error) return checked;
  const a = await token();
  const old = myPlayer();
  // Look first: overwriting someone else's name is refused by the rules, sometimes as 403 rather than 409.
  const res = await fetch(`${docsBase()}/names/${encodeURIComponent(checked.key)}`, {
    headers: { Authorization: `Bearer ${a.idToken}` }, referrerPolicy: 'strict-origin'
  });
  if (res.ok) {
    const doc = await res.json().catch(() => ({}));
    if (decode(doc.fields).uid !== a.uid) return { error: 'השם הזה כבר תפוס. נסו כינוי אחר.' };
  } else if (res.status !== 404) {
    throw new Error(`HTTP ${res.status}`);
  }
  const writes = [];
  if (old && old.key !== checked.key) writes.push({ delete: docName(`names/${old.key}`) });
  if (!old || old.key !== checked.key) {
    writes.push({
      update: { name: docName(`names/${checked.key}`), fields: { uid: str(a.uid) } },
      currentDocument: { exists: false }
    });
  }
  writes.push(playerWrite(a.uid, checked.name, checked.key, total));
  try {
    await commit(writes);
  } catch (e) {
    if (e.status === 409 || e.status === 403 || /exist|precondition/i.test(e.message)) return { error: 'השם הזה כבר תפוס. נסו כינוי אחר.' };
    throw e;
  }
  writeJson(PLAYER_KEY, { name: checked.name, key: checked.key });
  return { ok: true, name: checked.name };
}

export async function syncTotal(total) {
  const me = myPlayer();
  if (!cloudEnabled() || !me) return;
  const a = await token();
  await commit([playerWrite(a.uid, me.name, me.key, total)]);
}

// One score per person per day; the rules refuse a second one.
export async function submitDaily(date, score) {
  const me = myPlayer();
  if (!cloudEnabled() || !me) return false;
  const a = await token();
  const expire = new Date(Date.now() + DAILY_TTL_DAYS * 864e5).toISOString();
  try {
    await commit([{
      update: {
        name: docName(`daily/${date}_${a.uid}`),
        fields: { uid: str(a.uid), name: str(me.name), nameKey: str(me.key), date: str(date), score: int(score), expireAt: { timestampValue: expire } }
      },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }]
    }]);
  } catch (e) {
    if (e.status === 409 || /exist|precondition/i.test(e.message)) return true; // already in
    throw e;
  }
  return true;
}

export async function loadBoard() {
  const a = await token();
  const players = await query({
    from: [{ collectionId: 'players' }],
    orderBy: [{ field: { fieldPath: 'total' }, direction: 'DESCENDING' }],
    limit: 50
  });
  return players.map((p) => ({ ...p, me: p.id === a.uid }));
}

export async function loadDaily(date) {
  const a = await token();
  const rows = await query({
    from: [{ collectionId: 'daily' }],
    where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'EQUAL', value: str(date) } },
    limit: 200
  });
  return rows.map((r) => ({ ...r, me: r.uid === a.uid })).sort((x, y) => y.score - x.score);
}

// Stands in for a TTL policy: deletes up to 50 daily scores past their expireAt (the rules allow any signed-in visitor).
// Runs only for someone who already has a nickname, so a visitor never gets an account just for this. Failures are ignored.
export async function cleanupExpired() {
  if (!cloudEnabled() || !myPlayer()) return;
  try {
    const old = await query({
      from: [{ collectionId: 'daily' }],
      where: { fieldFilter: { field: { fieldPath: 'expireAt' }, op: 'LESS_THAN', value: { timestampValue: new Date().toISOString() } } },
      limit: 50
    });
    if (old.length) await commit(old.map((d) => ({ delete: docName(`daily/${d.id}`) })));
  } catch (e) { /* best effort */ }
}

// Removes the nickname, the scores and the anonymous account, then forgets this phone.
export async function deleteMe() {
  const me = myPlayer();
  const a = await token();
  // A commit takes at most 500 writes, so daily scores go in batches until none are left.
  for (;;) {
    const mine = await query({
      from: [{ collectionId: 'daily' }],
      where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: str(a.uid) } },
      limit: 400
    });
    if (!mine.length) break;
    await commit(mine.map((d) => ({ delete: docName(`daily/${d.id}`) })));
  }
  const writes = [{ delete: docName(`players/${a.uid}`) }];
  if (me) writes.push({ delete: docName(`names/${me.key}`) });
  await commit(writes);
  await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FIREBASE.apiKey}`, { idToken: a.idToken })
    .catch(() => { /* account already gone */ });
  writeJson(AUTH_KEY, null);
  writeJson(PLAYER_KEY, null);
}
