/* Personal progress, kept only on this phone (localStorage). */

import { esc } from './core.js';

const PROGRESS_KEY = 'lardo.progress.v1';

function loadProgress() {
  const fresh = { known: {}, miss: {}, best: {} };
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
      best: clean(p.best, isBest)
    };
  } catch (e) { /* private mode or corrupt value: start fresh */ }
  return fresh;
}

export const progress = loadProgress();

export function saveProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) { /* not saved, fine */ }
}

export function markResult(id, correct) {
  if (correct) {
    progress.miss[id] = Math.max(0, (progress.miss[id] || 0) - 1);
  } else {
    progress.miss[id] = (progress.miss[id] || 0) + 1;
    delete progress.known[id];
  }
  saveProgress();
}

export function setKnown(id, known) {
  if (known) progress.known[id] = true; else delete progress.known[id];
  saveProgress();
}

export const knownCount = (items) => items.filter((p) => progress.known[p.id]).length;

export const progressBar = (done, total, label) =>
  `<progress class="bar" max="${total}" value="${done}" aria-label="${esc(label)}: ${done} מתוך ${total}"></progress>`;
