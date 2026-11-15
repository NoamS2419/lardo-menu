/* The team score board, for approved staff only, under the name from the schedule.
   Uses the staff account (account.js); the rules refuse everyone else. Names are rendered with esc() only. */

import { TEAM_PROGRESS } from './config.js';
import { db } from './core.js';
import { teamStats, progress } from './progress.js';
import { cloudEnabled, setDoc, setWrite, deleteWrite, commit, list } from './fs.js';
import { account, cachedMember, loadMember } from './account.js';

const DAILY_TTL_DAYS = 60;

export { cloudEnabled };
export const teamProgressEnabled = () => cloudEnabled() && TEAM_PROGRESS;

// { uid, name } when this phone is signed in to an approved account (from the last known record).
export const myPlayer = () => {
  const m = cachedMember();
  return m && m.status === 'approved' ? { uid: m.uid, name: m.name } : null;
};

const extraFields = () => {
  if (!TEAM_PROGRESS || !db || !progress.shareProgress) return {}; // the write replaces the doc, so switching off removes them
  const t = teamStats(db.categories, db.byCat);
  return { onboarded: t.onboarded, known: t.known };
};

export async function syncTotal(total) {
  if (!cloudEnabled() || !myPlayer() || progress.offBoard) return;
  const m = await loadMember();
  if (!m || m.status !== 'approved') return;
  // The board entry carries no time; the private progress document holds it (the rules' rate limit).
  await commit([
    setWrite(`players/${m.uid}`, { name: m.name, total: Math.max(0, Math.floor(total)), ...extraFields() }),
    setWrite(`progress/${m.uid}`, {}, { stamp: ['updatedAt'] })
  ]);
}

// One score per person per day; the rules refuse a second one.
export async function submitDaily(date, score) {
  if (!cloudEnabled() || !myPlayer() || progress.offBoard) return false;
  const m = await loadMember();
  if (!m || m.status !== 'approved') return false;
  try {
    await commit([setWrite(`daily/${date}_${m.uid}`,
      { uid: m.uid, name: m.name, date, score: Math.max(0, Math.floor(score)), expireAt: new Date(Date.now() + DAILY_TTL_DAYS * 864e5) },
      { stamp: ['createdAt'], exists: false })]);
  } catch (e) {
    if (e.status === 409 || /exist|precondition/i.test(e.message)) return true; // already in
    throw e;
  }
  return true;
}

// Entries left from the old nickname board carry nameKey; they are hidden until cleaned up.
const current = (r) => !('nameKey' in r);

export async function loadBoard() {
  const me = account();
  const rows = await list('players', [], { orderBy: 'total', desc: true, limit: 100 });
  return rows.filter(current).slice(0, 50).map((p) => ({ ...p, me: me && p.id === me.uid }));
}

export async function loadDaily(date) {
  const me = account();
  const rows = await list('daily', [['date', '==', date]], { limit: 200 });
  return rows.filter(current).map((r) => ({ ...r, me: me && r.uid === me.uid })).sort((x, y) => y.score - x.score);
}

// Stands in for a TTL policy: deletes up to 50 daily scores past their expireAt. Failures are ignored.
export async function cleanupExpired() {
  if (!cloudEnabled() || !myPlayer()) return;
  try {
    const old = await list('daily', [['expireAt', '<', new Date()]], { limit: 50 });
    await Promise.allSettled(old.map((d) => commit([deleteWrite(`daily/${d.id}`)])));
  } catch (e) { /* best effort */ }
}

// Takes my score off the board (the account stays).
export async function leaveBoard() {
  const m = myPlayer();
  if (!m) return;
  const mine = await list('daily', [['uid', '==', m.uid]], { limit: 400 });
  await Promise.allSettled(mine.map((d) => commit([deleteWrite(`daily/${d.id}`)])));
  await commit([deleteWrite(`players/${m.uid}`)]);
}
