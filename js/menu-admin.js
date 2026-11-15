/* "התפריט והמוצרים": the scheduler's (and admin's) screens for changing the menu.
   Changes are saved as menu edits in Firestore (see menu.js) and shown to everyone on their next visit.
   Routes: #/shifts/menu, #/shifts/menu/p/<id>, #/shifts/menu/new, #/shifts/menu/faq, #/shifts/menu/tips */

import { db, setDb, esc, setPage, announce, priceLabel } from './core.js';
import { account, loadMember, runsBranch } from './account.js';
import { setDoc, deleteDoc } from './fs.js';
import { productDocId } from './menu.js';
import { loadData } from './catalog.js';
import { busy, errorState, loadingHtml } from './shifts.js';

const back = (href, label) => `<a class="back" href="${href}"><span aria-hidden="true">→</span> ${label}</a>`;
const field = (id, label, input, hint = '') => `
  <div class="field"><label for="${id}">${label}</label>${hint ? `<p class="hint">${hint}</p>` : ''}${input}</div>`;
const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanLong = (s, max) => String(s || '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

// Only schedulers and the admin; anyone else goes back to the shifts tab.
async function gate(route) {
  setPage('התפריט', `<h1 class="sr-only">התפריט</h1>${loadingHtml()}`);
  const me = await loadMember();
  if (location.hash !== route) return null;
  if (!runsBranch(me)) { location.hash = '#/shifts'; return null; }
  return me;
}

// After a save: load the menu again, so every screen shows the change.
async function reload() { setDb(await loadData()); }

const allProducts = () => [...db.products, ...db.hidden];
const findProduct = (id) => allProducts().find((p) => p.id === id);
const isHidden = (p) => db.hidden.includes(p);

/* ---------- the list ---------- */

export async function viewMenuAdmin() {
  const route = '#/shifts/menu';
  try {
    if (!(await gate(route))) return;
    const groups = db.allCategories.map((c) => {
      const items = allProducts().filter((p) => p.category === c.id).sort((a, b) => a.name.localeCompare(b.name, 'he'));
      if (!items.length) return '';
      return `<h2>${esc(c.name)}</h2><ul class="rows">${items.map((p) => `
        <li><a class="row-link" href="#/shifts/menu/p/${encodeURIComponent(p.id)}">
          <span class="row-title">${esc(p.name)}</span>
          <span>${isHidden(p) ? '<span class="tag">מוסתר</span>' : p.is_new ? '<span class="tag">חדש</span>' : p.edited ? '<span class="tag">נערך</span>' : ''}</span>
          <span class="row-sub full"><bdi>${esc(priceLabel(p))}</bdi></span></a></li>`).join('')}</ul>`;
    }).join('');
    setPage('התפריט והמוצרים', `
      ${back('#/shifts/manage', 'ניהול סידור')}
      <h1>התפריט והמוצרים</h1>
      <p>שינויים כאן מופיעים לכל הצוות, ונשארים גם כשהתפריט מתעדכן מוולט.</p>
      <ul class="rows">
        <li><a class="row-link" href="#/shifts/menu/new"><span class="row-title">הוספת מוצר</span><span></span></a></li>
        <li><a class="row-link" href="#/shifts/menu/faq"><span class="row-title">שאלות של לקוחות</span><span></span></a></li>
        <li><a class="row-link" href="#/shifts/menu/tips"><span class="row-title">טיפים למכירה</span><span></span></a></li>
      </ul>
      ${groups}`);
  } catch (ex) { errorState(ex, route); }
}

/* ---------- one product (or a new one) ---------- */

export async function viewMenuProduct(id) {
  const route = id ? `#/shifts/menu/p/${encodeURIComponent(id)}` : '#/shifts/menu/new';
  try {
    if (!(await gate(route))) return;
    const isNewForm = !id;
    const p = isNewForm ? { name: '', category: (db.allCategories[0] || {}).id, is_new: true } : findProduct(id);
    if (!p) { location.hash = '#/shifts/menu'; return; }
    const cats = db.allCategories.map((c) => `<option value="${esc(c.id)}"${c.id === p.category ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
    const hasSizes = p.sizes && p.sizes.length;
    setPage(isNewForm ? 'מוצר חדש' : p.name, `
      ${back('#/shifts/menu', 'התפריט והמוצרים')}
      <h1>${isNewForm ? 'מוצר חדש' : esc(p.name)}</h1>
      ${isNewForm ? '<p class="hint">למוצר חדש אין תמונה. הוא יופיע בתפריט ובכרטיסיות, לא במשחקי התמונות.</p>' : ''}
      <form id="menu-form" class="auth-form" novalidate>
        ${field('m-name', 'שם', `<input id="m-name" type="text" maxlength="60" required value="${esc(p.name)}">`)}
        ${field('m-cat', 'קטגוריה', `<select id="m-cat">${cats}</select>`)}
        ${field('m-price', 'מחיר בשקלים', `<input id="m-price" type="number" min="0" max="10000" step="0.5" inputmode="decimal" value="${typeof p.price === 'number' ? p.price : ''}">`,
          hasSizes ? 'למוצר יש כמה גדלים. מחיר שנכתב כאן יחליף אותם במחיר אחד.' : 'ריק = "המחיר בקופה".')}
        ${field('m-desc', 'תיאור לצוות', `<textarea id="m-desc" rows="4" maxlength="600">${esc(p.staff_description || p.description || '')}</textarea>`)}
        ${field('m-pitch', 'איך מציעים (טיפ למכירה)', `<textarea id="m-pitch" rows="2" maxlength="300">${esc((p.sales || {}).pitch || '')}</textarea>`)}
        ${isNewForm ? '' : `<label class="toggle-row"><input type="checkbox" id="m-hidden"${isHidden(p) ? ' checked' : ''}> להסתיר מהתפריט ומהמשחקים</label>`}
        <p class="form-err" id="form-err" role="alert"></p>
        <button class="btn btn-wide" type="submit">שמירה</button>
      </form>
      ${!isNewForm && (p.edited || p.is_new) ? `<button class="btn ghost btn-wide danger" type="button" id="m-reset">${p.is_new ? 'מחיקת המוצר' : 'ביטול השינויים (חזרה למה שבוולט)'}</button>` : ''}`);

    const form = document.getElementById('menu-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const err = document.getElementById('form-err');
        const name = clean(form['m-name'].value, 60);
        if (!name) { err.textContent = 'צריך לכתוב שם.'; form['m-name'].focus(); return; }
        const priceText = form['m-price'].value.trim();
        const price = priceText === '' ? null : Number(priceText);
        if (price != null && !(price >= 0 && price <= 10000)) { err.textContent = 'המחיר לא תקין.'; form['m-price'].focus(); return; }
        const pid = isNewForm ? `new-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : p.id;
        const data = {
          name, category: form['m-cat'].value, price,
          description: cleanLong(form['m-desc'].value, 600), pitch: cleanLong(form['m-pitch'].value, 300),
          hidden: !isNewForm && form['m-hidden'].checked, by: account().username
        };
        if (p.is_new) data.isNew = true;
        try {
          await setDoc(`menu/${productDocId(pid)}`, data, { stamp: ['updatedAt'] });
          await reload();
        } catch (ex) {
          err.textContent = ex.status === 403 ? 'אין הרשאה לשמור.' : 'לא הצלחנו לשמור. כדאי לנסות שוב.';
          console.error(ex);
          return;
        }
        location.hash = '#/shifts/menu';
        announce(`${name} נשמר`);
      });
    });
    document.getElementById('m-reset')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      if (!confirm(p.is_new ? `למחוק את ${p.name}?` : `לבטל את כל השינויים ב${p.name}?`)) return;
      try {
        await deleteDoc(`menu/${productDocId(p.id)}`);
        await reload();
        location.hash = '#/shifts/menu';
        announce(p.is_new ? 'המוצר נמחק' : 'השינויים בוטלו');
      } catch (ex) { document.getElementById('form-err').textContent = 'הפעולה לא הצליחה. כדאי לנסות שוב.'; console.error(ex); }
    }));
  } catch (ex) { errorState(ex, route); }
}

/* ---------- lists of texts: customer questions, sales tips ---------- */

const LISTS = {
  faq: {
    title: 'שאלות של לקוחות', docId: 'faq', a: ['topic', 'נושא', 60], b: ['text', 'תשובה', 600],
    items: () => db.faq.map((f) => ({ topic: f.topic, text: f.text }))
  },
  tips: {
    title: 'טיפים למכירה', docId: 'tips', a: ['title', 'מתי', 60], b: ['tip', 'מה מציעים', 400],
    items: () => db.situations.items.map((t) => ({ id: t.id, title: t.title, tip: t.tip }))
  }
};

export async function viewMenuList(kind) {
  const L = LISTS[kind];
  const route = `#/shifts/menu/${kind}`;
  try {
    if (!L || !(await gate(route))) return;
    const [ka, la, ma] = L.a; const [kb, lb, mb] = L.b;
    let items = L.items();
    const rowHtml = (it, i) => `
      <fieldset class="shift-row list-row" data-i="${i}"><legend>${i + 1}</legend>
        ${field(`a${i}`, la, `<input id="a${i}" type="text" maxlength="${ma}" value="${esc(it[ka] || '')}">`)}
        ${field(`b${i}`, lb, `<textarea id="b${i}" rows="3" maxlength="${mb}">${esc(it[kb] || '')}</textarea>`)}
        <button class="btn ghost small danger" type="button" data-remove="${i}">הסרה</button>
      </fieldset>`;
    const draw = () => {
      setPage(L.title, `
        ${back('#/shifts/menu', 'התפריט והמוצרים')}
        <h1>${L.title}</h1>
        <form id="list-form" novalidate>
          ${items.map(rowHtml).join('')}
          <button class="btn ghost btn-wide" type="button" id="add">הוספה</button>
          <p class="form-err" id="form-err" role="alert"></p>
          <button class="btn btn-wide" type="submit">שמירה</button>
        </form>`);
      bind();
    };
    // Keeps what was typed when rows are added or removed.
    const readForm = () => items.map((it, i) => ({ ...it, [ka]: document.getElementById(`a${i}`).value, [kb]: document.getElementById(`b${i}`).value }));
    const bind = () => {
      const form = document.getElementById('list-form');
      document.getElementById('add').addEventListener('click', () => {
        items = [...readForm(), kind === 'tips' ? { id: `t${Date.now().toString(36)}` } : {}];
        draw();
        document.getElementById(`a${items.length - 1}`).focus();
      });
      form.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
        const all = readForm(); all.splice(Number(b.dataset.remove), 1); items = all; draw();
        announce('הוסר. השינוי נשמר רק אחרי "שמירה".');
      }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(form.querySelector('[type=submit]'), async () => {
          const out = readForm().map((it) => ({ ...it, [ka]: clean(it[ka], ma), [kb]: cleanLong(it[kb], mb) }))
            .filter((it) => it[ka] && it[kb]).slice(0, 40);
          try {
            await setDoc(`menu/${L.docId}`, { items: out, by: account().username }, { stamp: ['updatedAt'] });
            await reload();
          } catch (ex) {
            document.getElementById('form-err').textContent = ex.status === 403 ? 'אין הרשאה לשמור.' : 'לא הצלחנו לשמור. כדאי לנסות שוב.';
            console.error(ex);
            return;
          }
          location.hash = '#/shifts/menu';
          announce('נשמר');
        });
      });
    };
    draw();
  } catch (ex) { errorState(ex, route); }
}
