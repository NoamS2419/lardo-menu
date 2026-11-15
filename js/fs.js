/* Firebase over REST (no SDK, so the CSP stays 'self'): Auth tokens and Firestore documents.
   Every read and write is checked by firestore.rules on the server; nothing here is trusted. */

import { FIREBASE, EMULATOR } from './config.js';

const AUTH_KEY = 'lardo.auth.v1';
const project = () => (EMULATOR ? 'demo-lardo' : FIREBASE.projectId);
const authBase = () => (EMULATOR ? `${EMULATOR.auth}/` : 'https://') + 'identitytoolkit.googleapis.com/v1';
const tokenBase = () => (EMULATOR ? `${EMULATOR.auth}/` : 'https://') + 'securetoken.googleapis.com/v1';
const docsBase = () => `${EMULATOR ? `${EMULATOR.firestore}` : 'https://firestore.googleapis.com'}/v1/projects/${project()}/databases/(default)/documents`;
export const docName = (path) => `projects/${project()}/databases/(default)/documents/${path}`;
const key = () => (EMULATOR ? 'emulator' : FIREBASE.apiKey);

export const cloudEnabled = () => Boolean(EMULATOR || (FIREBASE.apiKey && FIREBASE.projectId));

/* ---------- local storage (best effort) ---------- */

export function readJson(k) {
  try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; }
}
export function writeJson(k, value) {
  try {
    if (value == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(value));
  } catch (e) { /* not saved */ }
}

/* ---------- HTTP ---------- */

async function call(url, { method = 'POST', body, token } = {}) {
  const json = body ? JSON.stringify(body) : undefined;
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: json,
    keepalive: !!json && json.length < 60000, // a save started as the page closes still goes out
    referrerPolicy: 'strict-origin' // the API key may be restricted by referrer
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && (data.error.message || data.error.status)) || (Array.isArray(data) && data[0] && data[0].error && data[0].error.message) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = String(msg).split(' ')[0].split(':')[0];
    throw err;
  }
  return data;
}

/* ---------- auth ---------- */

// { uid, idToken, refreshToken, exp, email? }. Accounts from the old nickname board have no email.
export const authState = () => readJson(AUTH_KEY);
export const setAuth = (a) => writeJson(AUTH_KEY, a);

const fromAuthReply = (r, now = Date.now()) => ({
  uid: r.localId || r.user_id,
  idToken: r.idToken || r.id_token,
  refreshToken: r.refreshToken || r.refresh_token,
  exp: now + Number(r.expiresIn || r.expires_in) * 1000,
  email: r.email || undefined
});

export const authCall = (method, body) => call(`${authBase()}/accounts:${method}?key=${key()}`, { body });

// Signs in, or (with the old anonymous account's token) links a username to it, keeping its uid.
export async function passwordSignUp(email, password, anonIdToken) {
  // signUp with the anonymous idToken links the email and password to that same account (like the
  // official SDK does). accounts:update is refused while email enumeration protection is on.
  const r = await authCall('signUp', anonIdToken
    ? { idToken: anonIdToken, email, password, returnSecureToken: true }
    : { email, password, returnSecureToken: true });
  const a = { ...fromAuthReply(r), email };
  setAuth(a);
  return a;
}
export async function passwordSignIn(email, password) {
  const r = await authCall('signInWithPassword', { email, password, returnSecureToken: true });
  const a = { ...fromAuthReply(r), email };
  setAuth(a);
  return a;
}

let refreshing = null;
// A fresh ID token. Throws code SIGNED_OUT when there is no account or it can't be refreshed
// (password changed, account deleted): the caller shows the sign-in screen. Nothing is created here.
export async function token() {
  const a = authState();
  if (!a || !a.refreshToken) { const e = new Error('signed out'); e.code = 'SIGNED_OUT'; throw e; }
  if (a.idToken && a.exp > Date.now() + 60000) return a;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await call(`${tokenBase()}/token?key=${key()}`, { body: { grant_type: 'refresh_token', refresh_token: a.refreshToken } });
        const next = { ...fromAuthReply(r), email: a.email };
        setAuth(next);
        return next;
      } catch (e) {
        if (e.status === 400 || e.status === 401 || e.status === 403) {
          setAuth(null);
          e.code = 'SIGNED_OUT';
        }
        throw e;
      } finally { refreshing = null; }
    })();
  }
  return refreshing;
}

/* ---------- Firestore values ---------- */

export function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: encodeFields(v) } };
}
export const encodeFields = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encode(v)]));

export function decode(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields);
  return null;
}
export const decodeFields = (f = {}) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]));

/* ---------- Firestore documents ---------- */

// A document as a plain object with its id, or null when it doesn't exist.
export async function getDoc(path) {
  const a = await token();
  try {
    const d = await call(`${docsBase()}/${path}`, { method: 'GET', token: a.idToken });
    return { id: path.split('/').pop(), ...decodeFields(d.fields) };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function commit(writes) {
  const a = await token();
  return call(`${docsBase()}:commit`, { body: { writes }, token: a.idToken });
}

// A write: replaces the document (or only `mask` fields), with server timestamps for `stamp` fields.
export function setWrite(path, data, { stamp = [], mask, exists } = {}) {
  const w = { update: { name: docName(path), fields: encodeFields(data) } };
  if (mask) w.updateMask = { fieldPaths: mask };
  if (stamp.length) w.updateTransforms = stamp.map((f) => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' }));
  if (exists !== undefined) w.currentDocument = { exists };
  return w;
}
export const deleteWrite = (path) => ({ delete: docName(path) });
export const setDoc = (path, data, opts) => commit([setWrite(path, data, opts)]);
export const deleteDoc = (path) => commit([deleteWrite(path)]);

const OPS = { '==': 'EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', in: 'IN' };
// where: [[field, op, value], ...]. The rules only allow queries they can prove, so callers always
// filter by branch (or by their own uid).
export async function list(collection, where = [], { orderBy, desc, limit = 300 } = {}) {
  const a = await token();
  const filters = where.map(([f, op, v]) => ({ fieldFilter: { field: { fieldPath: f }, op: OPS[op], value: encode(v) } }));
  const structuredQuery = { from: [{ collectionId: collection }], limit };
  if (filters.length === 1) structuredQuery.where = filters[0];
  else if (filters.length) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
  if (orderBy) structuredQuery.orderBy = [{ field: { fieldPath: orderBy }, direction: desc ? 'DESCENDING' : 'ASCENDING' }];
  const rows = await call(`${docsBase()}:runQuery`, { body: { structuredQuery }, token: a.idToken });
  return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), ...decodeFields(r.document.fields) }));
}

// Reads a whole small collection that the rules leave open to everyone (the menu edits),
// without signing in. Up to 300 documents.
export async function listPublic(collection) {
  const r = await call(`${docsBase()}/${collection}?pageSize=300`, { method: 'GET' });
  return (r.documents || []).map((d) => ({ id: d.name.split('/').pop(), ...decodeFields(d.fields) }));
}
