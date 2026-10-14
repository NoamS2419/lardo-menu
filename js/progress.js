/* Personal progress, kept only on this phone (localStorage). */


const PROGRESS_KEY = 'lardo.progress.v1';

// Onboarding ("שבוע ראשון"): per day {cards, quiz:{score,of}, passed}, the final test and the name on the certificate.
function cleanOnboard(o) {
  const out = { days: {}, final: null, name: '' };
  if (!o || typeof o !== 'object') return out;
  const num = (v) => Number.isInteger(v) && v >= 0 && v <= 100;
  for (const [k, d] of Object.entries(o.days && typeof o.days === 'object' ? o.days : {})) {
    if (!/^[1-9]$/.test(k) || !d || typeof d !== 'object') continue;
    out.days[k] = {
      cards: d.cards === true,
      passed: d.passed === true,
      quiz: d.quiz && num(d.quiz.score) && num(d.quiz.of) ? { score: d.quiz.score, of: d.quiz.of } : null
    };
  }
  if (o.final && num(o.final.score) && num(o.final.of) && typeof o.final.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(o.final.date)) {
    out.final = { score: o.final.score, of: o.final.of, date: o.final.date, passed: o.final.passed === true };
  }
  if (typeof o.name === 'string') out.name = o.name.slice(0, 20);
  return out;
}

function loadProgress() {
  const fresh = { known: {}, miss: {}, best: {}, days: [], xp: 0, gameXp: 0, daily: {}, dailyRun: null, onboard: { days: {}, final: null, name: '' }, autoNext: false };
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    if (!p || typeof p !== 'object') return fresh;
    // Keep only well-formed entries: true flags and finite numbers.
    const clean = (obj, ok) => Object.fromEntries(
      Object.entries(obj && typeof obj === 'object' ? obj : {}).filter(([, v]) => ok(v)));
    const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    const isBest = (v) => v && typeof v === 'object' && isNum(v.score) && isNum(v.of) && v.of > 0;
    return {
      known: clean(p.known, (v) => v === true),
      miss: clean(p.miss, isNum),
      best: clean(p.best, isBest),
      xp: isNum(p.xp) ? Math.floor(p.xp) : 0,
      gameXp: isNum(p.gameXp) ? Math.floor(p.gameXp) : 0,
      daily: clean(p.daily, (v) => Number.isInteger(v) && v >= 0 && v <= 10),
      // A daily challenge in progress: which answers were given, so leaving can't reset it.
      dailyRun: p.dailyRun && typeof p.dailyRun.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(p.dailyRun.date)
        && Array.isArray(p.dailyRun.results) && p.dailyRun.results.length <= 10 && p.dailyRun.results.every((r) => typeof r === 'boolean')
        ? { date: p.dailyRun.date, results: p.dailyRun.results } : null,
      onboard: cleanOnboard(p.onboard),
      autoNext: p.autoNext === true,
      days: Array.isArray(p.days) ? p.days.filter((d) => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d)) : []
    };
  } catch (e) { /* private mode or corrupt value: start fresh */ }
  return fresh;
}

export const progress = loadProgress();

// What the team-progress board shows for this person: onboarding finished, and % known per category.
export function teamStats(categories, byCat) {
  const known = categories
    .filter((c) => /^[a-z]{1,20}$/.test(c.id) && (byCat.get(c.id) || []).length)
    .slice(0, 20)
    .map((c) => {
      const items = byCat.get(c.id);
      return `${c.id}:${Math.round((items.filter((p) => progress.known[p.id]).length / items.length) * 100)}`;
    }).join(',');
  return { onboarded: Boolean(progress.onboard.final && progress.onboard.final.passed), known };
}

export function saveProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) { /* not saved, fine */ }
}

export function markResult(id, correct) {
  touchDay();
  if (correct) {
    const m = (progress.miss[id] || 0) - 1;
    if (m > 0) progress.miss[id] = m; else delete progress.miss[id];
  } else {
    progress.miss[id] = (progress.miss[id] || 0) + 1;
    delete progress.known[id];
  }
  saveProgress();
}

export function setKnown(id, known) {
  touchDay();
  if (known) progress.known[id] = true; else delete progress.known[id];
  saveProgress();
}

export const knownCount = (items) => items.filter((p) => progress.known[p.id]).length;

export { meter as progressBar } from './core.js';

/* ---------- daily streak ---------- */

// Local calendar day, so the streak follows the shop's day, not UTC.
export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function touchDay() {
  const days = new Set(progress.days);
  if (!days.has(today())) { days.add(today()); progress.days = [...days].slice(-60); saveProgress(); }
}

// Consecutive days with any learning, counting back from today (or yesterday).
export function streak() {
  const days = new Set(progress.days);
  const d = new Date();
  if (!days.has(today(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(today(d))) { n += 1; d.setDate(d.getDate() - 1); }
  return n;
}

/* ---------- bakery levels ---------- */

const LEVELS = [
  { name: 'שוליה', min: 0 },
  { name: 'אופה', min: 150 },
  { name: 'אופה בכיר', min: 400 },
  { name: 'שף קונדיטור', min: 800 }
];

// fromGame: points earned by answering game questions. Only these count on the team board,
// so ticking "אני מכיר" can't inflate a score.
export function addXp(n, fromGame = false) {
  progress.xp = (progress.xp || 0) + n;
  if (fromGame) progress.gameXp = (progress.gameXp || 0) + n;
  saveProgress();
}

// Points come from game answers plus 5 for every product marked as known.
export function levelInfo() {
  const points = (progress.xp || 0) + Object.keys(progress.known).length * 5;
  let i = LEVELS.length - 1;
  while (points < LEVELS[i].min) i -= 1;
  const next = LEVELS[i + 1];
  const pct = next ? Math.round(((points - LEVELS[i].min) / (next.min - LEVELS[i].min)) * 100) : 100;
  return { points, name: LEVELS[i].name, next: next && next.name, toNext: next ? next.min - points : 0, pct };
}
