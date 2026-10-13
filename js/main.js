/* Entry point: loads the data, routes between pages, image fallbacks. */

import { db, setDb, main, focusMain, initial, esc } from './core.js';
import {
  loadData, viewHome, viewCategory, viewProduct, viewSearch, viewFaq, viewAccessibility, viewNotFound
} from './catalog.js';
import { viewLearnHub, viewFlashcards, viewGames, viewGame, hintText } from './learn.js';
import { viewTeam } from './team.js';

// A Wolt photo that fails to load is swapped for the placeholder tile,
// or, inside a game, for the ingredients clue. Inline onerror is blocked by the CSP.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.pid || !db) return;
  const p = db.byId.get(img.dataset.pid);
  if (!p) return;
  if (img.classList.contains('quiz-img')) {
    // The ingredients list could contain the name, so use the redacted hint instead.
    img.outerHTML = `<div class="clue"><p class="clue-label">התמונה לא נטענה. רמז:</p><p>${esc(hintText(p))}</p></div>`;
  } else {
    img.outerHTML = `<div class="${esc(img.className)} ph" aria-hidden="true">${initial(p.name)}</div>`;
  }
}, true);

/* ---------- router ---------- */

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  let parts;
  try {
    parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  } catch (e) {
    parts = ['?']; // malformed link: show "not found"
  }
  const params = new URLSearchParams(query);
  markTab(parts[0]);

  switch (parts[0]) {
    case undefined: viewHome(); break;
    case 'c': viewCategory(parts[1]); break;
    case 'p': viewProduct(parts[1]); break;
    case 'search': viewSearch(params.get('q') || ''); return; // keeps focus in the input
    case 'faq': viewFaq(); break;
    case 'learn': parts[1] ? viewFlashcards(parts[1]) : viewLearnHub(); break;
    case 'games': viewGames(); break;
    case 'game': viewGame(parts[1]); break;
    case 'accessibility': viewAccessibility(); break;
    case 'team': viewTeam(); break;
    default: viewNotFound();
  }
  focusMain();
}

// Highlight the tab for the current section.
function markTab(section) {
  const tab = { learn: 'learn', games: 'games', game: 'games', search: 'search', team: 'team' }[section] || 'home';
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

(async function start() {
  try {
    setDb(await loadData());
  } catch (err) {
    main.innerHTML = '<p class="empty">לא הצלחנו לטעון את המוצרים. נסו לרענן את הדף.</p>';
    console.error(err);
    return;
  }
  window.addEventListener('hashchange', route);
  route();
})();
