/* Emulator tests for firestore.shifts.rules. Run: npm run rules (needs Java). */
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, collection, getDocs, query, where
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-lardo',
  firestore: { rules: readFileSync(new URL('../firestore.shifts.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 }
});
const mail = (u) => `${u}@staff.lardo.invalid`;
const as = (u) => env.authenticatedContext(u, { email: mail(u) }).firestore();
const anonUser = env.authenticatedContext('anon1').firestore(); // old anonymous sign-in: no email
const nobody = env.unauthenticatedContext().firestore();
const now = serverTimestamp;
const exp = (days = 90) => Timestamp.fromMillis(Date.now() + days * 864e5);
const past = (h = 1) => Timestamp.fromMillis(Date.now() - h * 36e5);
const future = (h = 1) => Timestamp.fromMillis(Date.now() + h * 36e5);
const jer = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);

let pass = 0, fail = 0;
async function t(name, p) {
  try { await p; pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '::', String(e.message).slice(0, 400)); }
}
const ok = (name, p) => t(name, assertSucceeds(p));
const no = (name, p) => t(name, assertFails(p));
// Writes that bypass the rules, to set the scene.
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

const branch = (over = {}) => ({
  name: 'רעננה', active: true, closeDow: 3, closeMin: 0, publishDow: 5, lateOk: true,
  shifts: [{ id: 'm', name: 'בוקר', start: '06:30', end: '14:30' }, { id: 'e', name: 'ערב', start: '14:00', end: '20:30' }],
  need: { '0m': 2, '0e': 2 }, hours: {}, updatedAt: now(), ...over
});
const member = (username, over = {}) => ({ name: 'רוני ל.', username, branch: 'raanana', role: 'staff', status: 'pending', createdAt: now(), ...over });
const W = '2026-11-22';
const avail = (uid, over = {}) => ({
  branch: 'raanana', week: W, uid, name: 'רוני ל.', slots: ['0m', '2e'], note: '', updatedAt: now(), expireAt: exp(), by: 'self', ...over
});
const weekDoc = (over = {}) => ({
  branch: 'raanana', week: W, status: 'open', slots: {}, need: { '0m': 2 }, changed: [], changedFor: [], updatedAt: now(), expireAt: exp(), ...over
});
const draft = (over = {}) => ({ branch: 'raanana', week: W, slots: { '0m': [{ uid: 'roni', name: 'רוני ל.' }] }, updatedAt: now(), expireAt: exp(), ...over });

const noam = as('noam'), or = as('or'), roni = as('roni'), lia = as('lia'), dan = as('dan'), eve = as('eve'), omer = as('omer'), tlv = as('tlvboss');

/* ---------- branches ---------- */
await no('visitor cannot read branches', getDoc(doc(nobody, 'branches/raanana')));
await no('anonymous account cannot read branches', getDoc(doc(anonUser, 'branches/raanana')));
await no('employee cannot create a branch', setDoc(doc(roni, 'branches/raanana'), branch()));
await ok('admin creates the branch', setDoc(doc(noam, 'branches/raanana'), branch()));
await ok('admin creates a second branch', setDoc(doc(noam, 'branches/tlv'), branch({ name: 'תל אביב' })));
await no('admin cannot create a branch with a bad id', setDoc(doc(noam, 'branches/Bad Id'), branch()));
await no('branch with unknown field refused', setDoc(doc(noam, 'branches/x1'), branch({ owner: 'me' })));
await ok('a new account (not approved yet) reads branches', getDoc(doc(omer, 'branches/raanana')));

/* ---------- sign-up ---------- */
await no('cannot sign up as approved', setDoc(doc(roni, 'members/roni'), member('roni', { status: 'approved' })));
await no('cannot sign up as scheduler', setDoc(doc(roni, 'members/roni'), member('roni', { role: 'scheduler' })));
await no('cannot sign up under another username', setDoc(doc(roni, 'members/roni'), member('noam')));
await no('cannot sign up for someone else', setDoc(doc(roni, 'members/lia'), member('roni')));
await no('cannot sign up into a branch that does not exist', setDoc(doc(roni, 'members/roni'), member('roni', { branch: 'nowhere' })));
await no('cannot sign up with extra fields', setDoc(doc(roni, 'members/roni'), member('roni', { expireAt: exp() })));
await no('cannot sign up with a bad name', setDoc(doc(roni, 'members/roni'), member('roni', { name: '<b>x' })));
await no('anonymous account cannot sign up', setDoc(doc(anonUser, 'members/anon1'), member('anon1')));
await ok('roni signs up (pending)', setDoc(doc(roni, 'members/roni'), member('roni')));
await ok('lia signs up', setDoc(doc(lia, 'members/lia'), member('lia', { name: 'ליה מ.' })));
await ok('dan signs up', setDoc(doc(dan, 'members/dan'), member('dan', { name: 'דן כ.' })));
await ok('or signs up', setDoc(doc(or, 'members/or'), member('or', { name: 'אור' })));
await ok('omer signs up (stays pending)', setDoc(doc(omer, 'members/omer'), member('omer', { name: 'עומר כ.' })));
await ok('tlv manager signs up in tlv', setDoc(doc(tlv, 'members/tlvboss'), member('tlvboss', { name: 'טל', branch: 'tlv' })));
await ok('admin signs up as approved', setDoc(doc(noam, 'members/noam'), member('noam', { name: 'נועם ש.', status: 'approved' })));
await ok('roni reads own record', getDoc(doc(roni, 'members/roni')));
await no('roni cannot read lia', getDoc(doc(roni, 'members/lia')));
await no('roni cannot approve self', updateDoc(doc(roni, 'members/roni'), { status: 'approved', updatedAt: now() }));
await no('roni cannot rename self', updateDoc(doc(roni, 'members/roni'), { name: 'אחר', updatedAt: now() }));
await no('pending roni cannot list members', getDocs(query(collection(roni, 'members'), where('branch', '==', 'raanana'))));

/* ---------- roles ---------- */
await no('or (still staff) cannot approve roni', updateDoc(doc(or, 'members/roni'), { status: 'approved', updatedAt: now() }));
await no('or cannot make self scheduler', updateDoc(doc(or, 'members/or'), { role: 'scheduler', status: 'approved', updatedAt: now() }));
await ok('admin appoints or as scheduler', updateDoc(doc(noam, 'members/or'), { role: 'scheduler', status: 'approved', updatedAt: now() }));
await ok('admin appoints tlv manager', updateDoc(doc(noam, 'members/tlvboss'), { role: 'scheduler', status: 'approved', updatedAt: now() }));
await ok('or lists members of the branch', getDocs(query(collection(or, 'members'), where('branch', '==', 'raanana'))));
await no('or cannot list members of another branch', getDocs(query(collection(or, 'members'), where('branch', '==', 'tlv'))));
await no('or cannot list all members', getDocs(collection(or, 'members')));
await ok('or approves roni', updateDoc(doc(or, 'members/roni'), { status: 'approved', updatedAt: now() }));
await ok('or approves lia and fixes the name', updateDoc(doc(or, 'members/lia'), { status: 'approved', name: 'ליה מ', updatedAt: now() }));
await ok('or approves dan', updateDoc(doc(or, 'members/dan'), { status: 'approved', updatedAt: now() }));
await no('or cannot promote roni to scheduler', updateDoc(doc(or, 'members/roni'), { role: 'scheduler', updatedAt: now() }));
await no('or cannot move roni to another branch', updateDoc(doc(or, 'members/roni'), { branch: 'tlv', updatedAt: now() }));
await no('or cannot change a username', updateDoc(doc(or, 'members/roni'), { username: 'zzz', updatedAt: now() }));
await no('or cannot edit own record', updateDoc(doc(or, 'members/or'), { name: 'אור המלך', updatedAt: now() }));
await no('tlv manager cannot approve in raanana', updateDoc(doc(tlv, 'members/omer'), { status: 'approved', updatedAt: now() }));
await no('tlv manager cannot read a raanana member', getDoc(doc(tlv, 'members/roni')));
await no('approved roni cannot approve omer', updateDoc(doc(roni, 'members/omer'), { status: 'approved', updatedAt: now() }));
await no('approved roni still cannot change own role', updateDoc(doc(roni, 'members/roni'), { role: 'scheduler', updatedAt: now() }));
await no('roni cannot edit the branch', updateDoc(doc(roni, 'branches/raanana'), { lateOk: false, updatedAt: now() }));
await ok('or edits branch settings', updateDoc(doc(or, 'branches/raanana'), { closeDow: 2, need: { '0m': 3 }, updatedAt: now() }));
await no('or cannot rename the branch', updateDoc(doc(or, 'branches/raanana'), { name: 'שלי', updatedAt: now() }));
await no('or cannot edit another branch', updateDoc(doc(or, 'branches/tlv'), { closeDow: 2, updatedAt: now() }));
await no('or cannot delete the branch', deleteDoc(doc(or, 'branches/raanana')));

/* ---------- availability ---------- */
await ok('roni submits availability', setDoc(doc(roni, `availability/raanana_${W}_roni`), avail('roni')));
await ok('roni changes it', setDoc(doc(roni, `availability/raanana_${W}_roni`), avail('roni', { slots: ['1m'], note: 'עד 14:00' })));
await ok('roni reads own', getDoc(doc(roni, `availability/raanana_${W}_roni`)));
await ok('roni gets 404-style read of own missing week', getDoc(doc(roni, 'availability/raanana_2026-11-29_roni')));
await no('pending omer cannot submit', setDoc(doc(omer, `availability/raanana_${W}_omer`), avail('omer', { name: 'עומר כ.' })));
await no('roni cannot submit for lia', setDoc(doc(roni, `availability/raanana_${W}_lia`), avail('lia', { name: 'ליה מ' })));
await no('roni cannot submit under a wrong name', setDoc(doc(roni, `availability/raanana_${W}_roni`), avail('roni', { name: 'מישהו' })));
await no('roni cannot submit as manager', setDoc(doc(roni, `availability/raanana_${W}_roni`), avail('roni', { by: 'manager' })));
await no('roni cannot submit into another branch', setDoc(doc(roni, `availability/tlv_${W}_roni`), avail('roni', { branch: 'tlv' })));
await no('doc id must match the fields', setDoc(doc(roni, 'availability/raanana_2026-11-29_roni'), avail('roni')));
await no('note over 100 chars refused', setDoc(doc(roni, `availability/raanana_${W}_roni`), avail('roni', { note: 'x'.repeat(101) })));
await no('bad slot keys refused', setDoc(doc(roni, `availability/raanana_${W}_roni`), avail('roni', { slots: ['9zz!'] })));
await no('missing expiry refused', setDoc(doc(roni, `availability/raanana_${W}_roni`), (({ expireAt, ...r }) => r)(avail('roni'))));
await no('lia cannot read roni availability', getDoc(doc(lia, `availability/raanana_${W}_roni`)));
await no('lia cannot list the week', getDocs(query(collection(lia, 'availability'), where('branch', '==', 'raanana'), where('week', '==', W))));
await ok('lia lists her own', getDocs(query(collection(lia, 'availability'), where('uid', '==', 'lia'))));
await ok('or lists the week', getDocs(query(collection(or, 'availability'), where('branch', '==', 'raanana'), where('week', '==', W))));
await no('tlv manager cannot list raanana', getDocs(query(collection(tlv, 'availability'), where('branch', '==', 'raanana'), where('week', '==', W))));
await no('tlv manager cannot read roni availability', getDoc(doc(tlv, `availability/raanana_${W}_roni`)));
await ok('or enters availability for dan', setDoc(doc(or, `availability/raanana_${W}_dan`), avail('dan', { name: 'דן כ.', by: 'manager' })));
await no('or cannot enter availability in another branch', setDoc(doc(or, `availability/tlv_${W}_dan`), avail('dan', { branch: 'tlv', name: 'דן כ.', by: 'manager' })));

/* ---------- the deadline ---------- */
await no('roni cannot create the week doc', setDoc(doc(roni, `schedules/raanana_${W}`), weekDoc()));
await ok('or opens the week, closing in an hour', setDoc(doc(or, `schedules/raanana_${W}`), weekDoc({ closesAt: future() })));
await ok('before the deadline: roni submits', setDoc(doc(roni, `availability/raanana_${W}_roni`), avail('roni')));
await ok('or moves the deadline to the past', setDoc(doc(or, `schedules/raanana_${W}`), weekDoc({ closesAt: past() })));
await ok('late, branch allows late: roni submits', setDoc(doc(roni, `availability/raanana_${W}_roni`), avail('roni', { slots: ['3m'] })));
await ok('or turns late submissions off', updateDoc(doc(or, 'branches/raanana'), { lateOk: false, updatedAt: now() }));
await no('late, branch strict: roni refused', setDoc(doc(roni, `availability/raanana_${W}_roni`), avail('roni', { slots: ['4m'] })));
await no('late, branch strict: roni cannot delete either', deleteDoc(doc(roni, `availability/raanana_${W}_roni`)));
await ok('late, branch strict: or still enters for roni', setDoc(doc(or, `availability/raanana_${W}_roni`), avail('roni', { by: 'manager' })));
await ok('or turns late submissions back on', updateDoc(doc(or, 'branches/raanana'), { lateOk: true, updatedAt: now() }));

/* ---------- drafts and publishing ---------- */
await ok('or saves a draft', setDoc(doc(or, `drafts/raanana_${W}`), draft()));
await no('roni cannot read the draft', getDoc(doc(roni, `drafts/raanana_${W}`)));
await no('roni cannot read a missing draft', getDoc(doc(roni, 'drafts/raanana_2026-11-29')));
await no('roni cannot list drafts', getDocs(query(collection(roni, 'drafts'), where('branch', '==', 'raanana'))));
await no('roni cannot write a draft', setDoc(doc(roni, `drafts/raanana_${W}`), draft()));
await no('tlv manager cannot read the raanana draft', getDoc(doc(tlv, `drafts/raanana_${W}`)));
await no('tlv manager cannot write a raanana draft', setDoc(doc(tlv, `drafts/raanana_${W}`), draft()));
await ok('roni reads the open week doc (no names in it)', getDoc(doc(roni, `schedules/raanana_${W}`)));
await no('an open week doc cannot carry names', setDoc(doc(or, `schedules/raanana_${W}`), weekDoc({ slots: { '0m': [{ uid: 'roni', name: 'רוני ל.' }] } })));
await no('pending omer cannot read the week', getDoc(doc(omer, `schedules/raanana_${W}`)));
await no('visitor cannot read the week', getDoc(doc(nobody, `schedules/raanana_${W}`)));
await no('anonymous account cannot read the week', getDoc(doc(anonUser, `schedules/raanana_${W}`)));
await no('roni cannot publish', setDoc(doc(roni, `schedules/raanana_${W}`), weekDoc({ status: 'published', slots: { '0m': [] }, publishedAt: now() })));
await ok('or publishes', setDoc(doc(or, `schedules/raanana_${W}`), weekDoc({ status: 'published', slots: { '0m': [{ uid: 'roni', name: 'רוני ל.' }] }, publishedAt: now(), closesAt: past() })));
await ok('roni reads the published schedule', getDoc(doc(roni, `schedules/raanana_${W}`)));
await ok('roni lists the branch schedules', getDocs(query(collection(roni, 'schedules'), where('branch', '==', 'raanana'))));
await no('tlv manager cannot read the raanana schedule', getDoc(doc(tlv, `schedules/raanana_${W}`)));
await no('after publishing: roni cannot change availability', setDoc(doc(roni, `availability/raanana_${W}_roni`), avail('roni', { slots: ['5m'] })));
await ok('after publishing: or can still fix availability', setDoc(doc(or, `availability/raanana_${W}_roni`), avail('roni', { by: 'manager' })));
await ok('admin (stand-in) reads the draft', getDoc(doc(noam, `drafts/raanana_${W}`)));
await ok('admin (stand-in) republishes', setDoc(doc(noam, `schedules/raanana_${W}`), weekDoc({ status: 'published', slots: { '0m': [] }, changed: ['0m'], changedFor: ['roni'], publishedAt: now() })));

/* ---------- standing availability and time off ---------- */
const standing = (uid, over = {}) => ({ branch: 'raanana', uid, name: 'רוני ל.', slots: ['0m'], note: '', updatedAt: now(), ...over });
await ok('roni saves standing availability', setDoc(doc(roni, 'standing/roni'), standing('roni')));
await no('roni cannot save standing for lia', setDoc(doc(roni, 'standing/lia'), standing('lia')));
await no('lia cannot read roni standing', getDoc(doc(lia, 'standing/roni')));
await ok('or lists standing for the branch', getDocs(query(collection(or, 'standing'), where('branch', '==', 'raanana'))));
await no('pending omer cannot save standing', setDoc(doc(omer, 'standing/omer'), standing('omer', { name: 'עומר כ.' })));
await ok('roni removes standing', deleteDoc(doc(roni, 'standing/roni')));
const off = (uid, over = {}) => ({ branch: 'raanana', uid, name: 'רוני ל.', from: '2026-12-01', to: '2026-12-03', note: '', createdAt: now(), expireAt: exp(), ...over });
await ok('roni asks for time off', setDoc(doc(roni, 'timeoff/t1'), off('roni')));
await no('roni cannot ask time off for lia', setDoc(doc(roni, 'timeoff/t2'), off('lia')));
await no('time off with from after to refused', setDoc(doc(roni, 'timeoff/t3'), off('roni', { from: '2026-12-05' })));
await no('lia cannot read roni time off', getDoc(doc(lia, 'timeoff/t1')));
await ok('or lists time off', getDocs(query(collection(or, 'timeoff'), where('branch', '==', 'raanana'))));
await ok('roni lists own time off', getDocs(query(collection(roni, 'timeoff'), where('uid', '==', 'roni'))));
await ok('roni cancels time off', deleteDoc(doc(roni, 'timeoff/t1')));

/* ---------- disabling ---------- */
await ok('or disables dan', updateDoc(doc(or, 'members/dan'), { status: 'disabled', expireAt: exp(), updatedAt: now() }));
await no('disabled dan cannot read the schedule', getDoc(doc(dan, `schedules/raanana_${W}`)));
await no('disabled dan cannot submit', setDoc(doc(dan, 'availability/raanana_2026-11-29_dan'), avail('dan', { name: 'דן כ.', week: '2026-11-29' })));
await no('disabled dan cannot re-approve self', updateDoc(doc(dan, 'members/dan'), { status: 'approved', updatedAt: now() }));
await no('disabled dan cannot read the board', getDocs(collection(dan, 'players')));
await ok('or rejects omer (deletes the request)', deleteDoc(doc(or, 'members/omer')));
await no('or cannot delete an approved employee record', deleteDoc(doc(or, 'members/roni')));
await no('tlv manager cannot delete a raanana request', deleteDoc(doc(tlv, 'members/dan')));

/* ---------- retention ---------- */
await seed(async (f) => {
  await setDoc(doc(f, 'availability/raanana_2026-07-05_roni'), { branch: 'raanana', week: '2026-07-05', uid: 'roni', name: 'רוני ל.', slots: [], note: '', by: 'self', expireAt: past(24) });
  await setDoc(doc(f, 'schedules/raanana_2026-07-05'), { branch: 'raanana', week: '2026-07-05', status: 'published', slots: {}, need: {}, changed: [], changedFor: [], expireAt: past(24) });
  await setDoc(doc(f, 'schedules/raanana_2026-11-15'), { branch: 'raanana', week: '2026-11-15', status: 'published', slots: {}, need: {}, changed: [], changedFor: [], expireAt: future(24) });
});
await no('lia cannot delete a schedule that has not expired', deleteDoc(doc(lia, 'schedules/raanana_2026-11-15')));
await ok('any approved employee may clean an expired schedule', deleteDoc(doc(lia, 'schedules/raanana_2026-07-05')));
await ok('or cleans expired availability', deleteDoc(doc(or, 'availability/raanana_2026-07-05_roni')));

/* ---------- the score board ---------- */
const player = (over = {}) => ({ name: 'רוני ל.', total: 120, updatedAt: now(), ...over });
await ok('roni writes own score under the schedule name', setDoc(doc(roni, 'players/roni'), player()));
await ok('roni shares progress', setDoc(doc(roni, 'players/roni'), player({ onboarded: true, known: 'breads:40,pastries:100' })));
await no('roni cannot use a nickname', setDoc(doc(roni, 'players/roni'), player({ name: 'המלך' })));
await no('roni cannot write lia score', setDoc(doc(roni, 'players/lia'), player({ name: 'ליה מ' })));
await no('negative total refused', setDoc(doc(roni, 'players/roni'), player({ total: -1 })));
await no('bad known string refused', setDoc(doc(roni, 'players/roni'), player({ known: 'x:999' })));
await no('anonymous account cannot write a score', setDoc(doc(anonUser, 'players/anon1'), { name: 'anon', total: 1, updatedAt: now() }));
await no('anonymous account cannot read the board', getDocs(collection(anonUser, 'players')));
await no('visitor cannot read the board', getDocs(collection(nobody, 'players')));
await ok('lia reads the board', getDocs(collection(lia, 'players')));
const today = jer();
const daily = (uid, over = {}) => ({ uid, name: 'רוני ל.', date: today, score: 7, createdAt: now(), expireAt: exp(60), ...over });
await ok('roni posts today\'s score', setDoc(doc(roni, `daily/${today}_roni`), daily('roni')));
await no('roni cannot change it', setDoc(doc(roni, `daily/${today}_roni`), daily('roni', { score: 10 })));
await no('score above 10 refused', setDoc(doc(lia, `daily/${today}_lia`), daily('lia', { name: 'ליה מ', score: 11 })));
await no('a score for another day refused', setDoc(doc(lia, 'daily/2026-01-01_lia'), daily('lia', { name: 'ליה מ', date: '2026-01-01' })));
await ok('lia reads today\'s scores', getDocs(query(collection(lia, 'daily'), where('date', '==', today))));
await no('lia cannot delete roni score', deleteDoc(doc(lia, `daily/${today}_roni`)));
await ok('or removes a score (employee left)', deleteDoc(doc(or, `daily/${today}_roni`)));
await ok('roni saves learning progress', setDoc(doc(roni, 'progress/roni'), { data: '{}', updatedAt: now() }));
await ok('roni reads it back', getDoc(doc(roni, 'progress/roni')));
await no('lia cannot read roni progress', getDoc(doc(lia, 'progress/roni')));
await no('or cannot read roni progress', getDoc(doc(or, 'progress/roni')));
await no('nobody writes old nickname reservations', setDoc(doc(roni, 'names/x'), { uid: 'roni' }));
await no('unknown collections are closed', getDoc(doc(noam, 'secrets/x')));

/* ---------- leaving ---------- */
await ok('roni deletes own account record', deleteDoc(doc(roni, 'members/roni')));
await no('after leaving: no schedule', getDoc(doc(roni, `schedules/raanana_${W}`)));
await ok('or may delete own record (leaving)', deleteDoc(doc(or, 'members/or')));
await no('after leaving: or cannot read drafts', getDoc(doc(or, `drafts/raanana_${W}`)));
await ok('admin deletes a branch', deleteDoc(doc(noam, 'branches/tlv')));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
