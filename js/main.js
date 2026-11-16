/* Entry point: loads the data, routes between pages, image fallbacks. */

import { db, setDb, main, focusMain, initial, esc } from './core.js';
import { viewMenuAdmin, viewMenuProduct, viewMenuList } from './menu-admin.js';
import {
  loadData, viewHome, viewCategory, viewProduct, viewSearch, viewFaq, viewAccessibility, viewNotFound
} from './catalog.js';
import { viewLearnHub, viewFlashcards, viewGames, viewGame, hintText } from './learn.js';
import { viewTeam } from './team.js';
import { viewSell } from './catalog.js';
import { viewOnboard, viewOnboardDay, viewOnboardFinal, viewOnboardCert } from './onboard.js';
import { cloudEnabled } from './fs.js';
import { cachedMember, account } from './account.js';
import { listenForInstallPrompt } from './install.js';

listenForInstallPrompt();
import { viewShifts, viewAvailability, viewTimeOff } from './shifts.js';
import { viewManage, viewPeople, viewPersonAvailability, viewSettings, viewBuild, viewBranches } from './manage.js';

// With large text the tab bar grows; keep the page's bottom padding in step with its real height.
const tabs = document.querySelector('.tabs');
if (tabs && 'ResizeObserver' in window) {
  new ResizeObserver(() => {
    const h = tabs.getBoundingClientRect().height;
    if (h) document.body.style.setProperty('--tab-real', `${Math.ceil(h)}px`);
  }).observe(tabs);
}

// The shifts tab only shows once Firebase is configured (js/config.js).
if (!cloudEnabled()) {
  document.querySelector('.tabs a[data-tab="shifts"]')?.remove();
  document.querySelector('.tabs')?.classList.add('four');
}

// A Wolt photo that fails to load is swapped for the placeholder tile,
// or, inside a game, for the ingredients clue. Inline onerror is blocked by the CSP.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.pid || !db) return;
  const p = db.byId.get(img.dataset.pid);
  if (!p) return;
  if (img.classList.contains('quiz-img')) {
    // The ingredients list could contain the name, so use the redacted hint instead.
    // The hint replaces the image, so drop the screen-reader copy next to it.
    const sib = img.nextElementSibling;
    if (sib && sib.classList.contains('sr-only')) sib.remove();
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
    case 'shifts':
      if (!parts[1]) viewShifts();
      else if (parts[1] === 'avail') viewAvailability();
      else if (parts[1] === 'off') viewTimeOff();
      else if (parts[1] === 'manage') viewManage();
      else if (parts[1] === 'people' && parts[2]) viewPersonAvailability(parts[2]);
      else if (parts[1] === 'people') viewPeople();
      else if (parts[1] === 'settings') viewSettings();
      else if (parts[1] === 'build') viewBuild(params.get('w'));
      else if (parts[1] === 'branches') viewBranches();
      else if (parts[1] === 'menu' && parts[2] === 'p') viewMenuProduct(parts[3]);
      else if (parts[1] === 'menu' && parts[2] === 'new') viewMenuProduct(null);
      else if (parts[1] === 'menu' && parts[2]) viewMenuList(parts[2]);
      else if (parts[1] === 'menu') viewMenuAdmin();
      else viewNotFound();
      break;
    case 'sell': viewSell(); break;
    case 'onboard':
      if (parts[1] === 'day') viewOnboardDay(parts[2], parts[3]);
      else if (parts[1] === 'final') viewOnboardFinal();
      else if (parts[1] === 'cert') viewOnboardCert();
      else viewOnboard();
      break;
    default: viewNotFound();
  }
  focusMain();
}

// Highlight the tab for the current section.
function markTab(section) {
  const tab = { learn: 'learn', onboard: 'learn', games: 'games', game: 'games', search: 'search', shifts: 'shifts', team: 'shifts' }[section] || 'home';
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

// Not inside someone else's frame (clickjacking): GitHub Pages can't send X-Frame-Options.
if (window.top !== window.self) document.documentElement.hidden = true;

(async function start() {
  try {
    setDb(await loadData());
  } catch (err) {
    main.innerHTML = '<p class="empty">לא הצלחנו לטעון את המוצרים. נסו לרענן את הדף.</p>';
    console.error(err);
    return;
  }
  // Shifts are the heart of the site for the team: an approved employee who opens the site lands there
  // (the menu is one tap away). Visitors and everyone else start on the menu as before.
  const m = cachedMember();
  if (!location.hash && ((m && m.status === 'approved') || account()?.isAdmin)) history.replaceState(null, '', '#/shifts');
  window.addEventListener('hashchange', route);
  route();
})();

// Works offline after the first visit (see sw.js).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
