/* Local test site on the Firebase emulators, with test accounts (so testing never needs Or).
   Run: cd tests && npm run dev, then open http://localhost:8123/?emu
   Accounts (password "password1"): noam (admin), or (scheduler), roni and lia (approved), dan (pending).
   Pass --empty for an empty project with the old rules live, to rehearse launch day. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const AUTH = 'http://127.0.0.1:9099';
const FS = 'http://127.0.0.1:8085';
const PROJECT = 'demo-lardo';
const PORT = Number(process.env.PORT || 8123);
const empty = process.argv.includes('--empty');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.rules': 'text/plain' };

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    let body = await readFile(file);
    if (path.endsWith('index.html')) {
      body = body.toString().replace('connect-src \'self\'', `connect-src 'self' ${AUTH} ${FS}`);
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch (e) {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`site: http://localhost:${PORT}/?emu`));

async function post(url, body, headers = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url}: ${JSON.stringify(j)}`);
  return j;
}
const signUp = (u) => post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=x`, { email: `${u}@staff.lardo.invalid`, password: 'password1', returnSecureToken: true }).then((r) => r.localId);

const enc = (v) => {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const docs = `projects/${PROJECT}/databases/(default)/documents`;
const put = (writes) => post(`${FS}/v1/${docs}:commit`, {
  writes: writes.map(([path, data]) => ({ update: { name: `${docs}/${path}`, fields: enc(data).mapValue.fields } }))
}, { Authorization: 'Bearer owner' });

async function setRules(adminUid) {
  const rules = (await readFile(join(ROOT, 'firestore.rules'), 'utf8')).replace('__ADMIN_UID__', adminUid);
  const r = await fetch(`${FS}/emulator/v1/projects/${PROJECT}:securityRules`, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ content: rules }] } }) });
  if (!r.ok) throw new Error(`rules: ${await r.text()}`);
}

const sunday = (d = new Date()) => {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return new Date(t - new Date(t).getUTCDay() * 864e5);
};
const iso = (d) => d.toISOString().slice(0, 10);

if (empty) {
  // Like launch day: the old rules are live until the admin pastes the new ones from the site.
  const old = await readFile(join(ROOT, 'tests/old-live.rules'), 'utf8');
  const live = old.includes('__ADMIN_UID__') ? old.replace('__ADMIN_UID__', 'nobody-yet') : old;
  const r = await fetch(`${FS}/emulator/v1/projects/${PROJECT}:securityRules`, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ content: live }] } }) });
  if (!r.ok) throw new Error(`rules: ${await r.text()}`);
  console.log('empty project with the current firestore.rules; paste new rules with PUT /emulator/v1/projects/demo-lardo:securityRules');
} else {
  const [noam, or, roni, lia, dan] = await Promise.all(['noam', 'or', 'roni', 'lia', 'dan'].map(signUp));
  await setRules(noam);
  const now = new Date();
  const thisW = sunday(); const nextW = new Date(thisW.getTime() + 7 * 864e5);
  const expire = new Date(Date.now() + 120 * 864e5);
  const member = (name, username, extra = {}) => ({ name, username, branch: 'raanana', role: 'staff', status: 'approved', createdAt: now, updatedAt: now, ...extra });
  await put([
    ['branches/raanana', {
      name: 'רעננה', active: true, closeDow: 3, closeMin: 1440, publishDow: 5, lateOk: true,
      shifts: [{ id: 'm', name: 'בוקר', start: '06:30', end: '14:30' }, { id: 'e', name: 'ערב', start: '14:00', end: '20:30' }],
      need: { '0m': 2, '0e': 2, '1m': 2, '1e': 2, '2m': 2, '2e': 2, '3m': 2, '3e': 2, '4m': 2, '4e': 2, '5m': 3, '5e': 0 },
      hours: { '5m': '06:30-15:00' }, updatedAt: now
    }],
    [`members/${noam}`, member('נועם ש.', 'noam')],
    [`members/${or}`, member('אור', 'or', { role: 'scheduler' })],
    [`members/${roni}`, member('רוני ל.', 'roni')],
    [`members/${lia}`, member('ליה מ.', 'lia')],
    [`members/${dan}`, member('דן כ.', 'dan', { status: 'pending' })],
    [`availability/raanana_${iso(nextW)}_${lia}`, { branch: 'raanana', week: iso(nextW), uid: lia, name: 'ליה מ.', slots: ['0m', '1m', '2e', '4m'], note: 'השבוע רק בקרים', by: 'self', updatedAt: now, expireAt: expire }],
    [`schedules/raanana_${iso(thisW)}`, {
      branch: 'raanana', week: iso(thisW), status: 'published', closesAt: now, publishedAt: now, updatedAt: now, expireAt: expire,
      slots: { '0m': [{ uid: roni, name: 'רוני ל.', start: '07:00' }, { uid: lia, name: 'ליה מ.' }], '3e': [{ uid: roni, name: 'רוני ל.' }], '5m': [{ uid: roni, name: 'רוני ל.' }, { uid: or, name: 'אור' }] },
      need: {}, changed: ['5m'], changedFor: [roni]
    }]
  ]);
  console.log('seeded: noam (admin), or (scheduler), roni, lia (approved), dan (pending); password "password1"');
}
await new Promise(() => {}); // keep serving until stopped
