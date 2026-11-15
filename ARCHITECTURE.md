# How the site works (for programmers)

A staff site for one bakery branch: learn the products (menu, flashcards, games) and run the weekly
shift schedule. It is a **static site** (plain HTML, CSS and JavaScript modules, no build step,
no framework) on GitHub Pages, with **Firebase** (Auth + Firestore, free Spark plan) for accounts
and shared data. The UI is Hebrew, right to left.

## The big picture

```
browser ──► index.html + style.css + js/*.js        (GitHub Pages, cached offline by sw.js)
   │
   ├──► data/products.json                          (menu snapshot from Wolt, built by tools/)
   │
   └──► Firebase over plain REST (js/fs.js)
          Auth:      username + password  (username@staff.lardo.invalid, no real email)
          Firestore: members, schedules, availability, menu edits, score board …
          Security:  firestore.rules decides everything; the UI only offers what the rules allow
```

There is no server code. **All security lives in `firestore.rules`.** Never rely on the UI to
hide something: if the rules allow a read, anyone signed in can make it.

## Files

| File | What it does |
|---|---|
| `index.html` | The page shell: header, bottom tabs, `<main>`. Strict CSP (no inline scripts). |
| `js/main.js` | Entry point: loads the data, the router (`route()` reads `location.hash`), image fallbacks. |
| `js/core.js` | Shared state (`db`, the loaded products) and small helpers (`esc`, `setPage`, `backLink`, `stillAt`). |
| `js/catalog.js` | Menu pages: home, category, product, search, FAQ, sales tips, accessibility statement. `loadData()` lives here. |
| `js/menu.js` | Menu edits from Firestore laid over `products.json` (`applyMenuEdits`). |
| `js/menu-admin.js` | Screens where the scheduler edits the menu. |
| `js/learn.js`, `js/onboard.js` | Flashcards, games, the first-week course. |
| `js/progress.js` | Personal learning progress, stored only in the phone (`localStorage`). |
| `js/team.js`, `js/cloud.js` | The team score board (approved staff only). |
| `js/fs.js` | Firebase REST: sign in/up, token refresh, `getDoc`, `setDoc`, `commit`, `list`, `listPublic`. |
| `js/account.js` | Accounts and the member record (`members/{uid}`), sign-up flow, roles, branches. |
| `js/week.js` | Dates in Israel time: weeks (named by their Sunday), slots, deadlines. |
| `js/shifts.js` | Employee shift screens: sign in, my shifts, availability, time off, the home-page card. |
| `js/manage.js` | Scheduler screens: team and approvals, settings, building and publishing the schedule. |
| `js/share.js` | Draws the published week as a picture for WhatsApp (canvas, no outside service). |
| `js/calendar.js` | "Add to calendar": my upcoming shifts as an `.ics` file, made in the browser. |
| `js/install.js` | "Install on your phone" card (iPhone steps, Android install prompt). |
| `sw.js` | Service worker: caches the site for offline use. **Bump `VERSION` when you change files.** |
| `firestore.rules` | Who may read and write what. Tested in `tests/rules.test.mjs`. |
| `tools/` | Python scripts that build `data/products.json` from Wolt (see `tools/README.md`). |

Each JS file starts with a short comment that says what it is for.

## Roles

| Who | How it's decided | Can |
|---|---|---|
| Visitor | not signed in | menu, flashcards, games |
| Employee | `members/{uid}` with `status: 'approved'` | + shifts: submit availability, time off, see the published schedule, score board |
| Scheduler (Or) | member with `role: 'scheduler'` | + everything for their branch: approve people, build and publish, settings, **edit the menu** |
| Main admin (`noam`) | a fixed uid in the rules (`adminUid()`) | + appoint schedulers, branches, everything |

The admin uid is a placeholder `__ADMIN_UID__` in `firestore.rules`. The admin signs in on the
site, taps "העתקת החוקים" (copy rules) in the account section, and pastes the result into the
Firebase console. That is also how rules changes are deployed.

## Data (Firestore)

| Collection | Document id | Who reads | Notes |
|---|---|---|---|
| `branches` | `raanana` | any account | shifts, hours, how many people per shift, deadline |
| `members` | uid | self, scheduler, admin | name, username, branch, role, status |
| `availability` | `<branch>_<week>_<uid>` | self, scheduler | one per person per week |
| `standing` | uid | self, scheduler | "same every week" availability |
| `timeoff` | `<uid>_<from>` | self, scheduler | time-off requests |
| `schedules` | `<branch>_<week>` | branch staff | the published week (`status: 'published'`) |
| `drafts` | `<branch>_<week>` | scheduler | the week being built, saved slot by slot |
| `players`, `daily` | uid / `<date>_<uid>` | approved staff | score board (no timestamps, for privacy) |
| `progress` | uid | self | time of the last board update (rate limit) |
| `menu` | `p_<productId>`, `faq`, `tips` | everyone | menu edits, see `js/menu.js` |

Personal documents carry `expireAt` (about 3 months). The app deletes expired ones itself
(there is no TTL policy on the free plan).

## Common changes

- **A new page:** write a `viewSomething()` function that calls `setPage(title, html)`, add a
  `case` in `route()` in `js/main.js`, and add the file to `FILES` in `sw.js` if it is new.
- **Text on screen:** it is in the view functions, in Hebrew. Always pass user data through `esc()`.
- **A new field in Firestore:** add it to the matching `validX()` / `keys().hasOnly([...])` in
  `firestore.rules`, add a test in `tests/rules.test.mjs`, run the tests, and re-paste the rules.
- **Styles:** `style.css` uses color and spacing tokens (`--accent`, `--sp-3` …) defined at the top,
  with a dark-mode block. Use the tokens, not raw colors.

## Testing

```
cd tests && npm install
npm run rules       # Firestore rules tests on the emulator (must all pass)
npm run dev         # the site on local emulators with test accounts: http://localhost:8123/?emu
npm run dev:empty   # an empty project with the old rules, to rehearse launch day
```

Test accounts in `npm run dev` (password `password1`): `noam` (admin), `or` (scheduler),
`roni`, `lia` (employees), `dan` (pending).
