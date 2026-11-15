/* Menu edits: changes the schedulers make to the menu, kept in Firestore ("menu" collection) and
   laid over the Wolt snapshot (data/products.json) every time the site loads. Because they are
   applied on top, they survive every Wolt refresh.

   Documents:
     menu/p_<productId>  changes to one product, or a whole new product (isNew: true)
                         fields: name, description, price, category, hidden, pitch, isNew
     menu/faq            { items: [{ topic, text }] }   replaces the customer questions page
     menu/tips           { items: [{ id, title, tip }] } replaces the sales tips texts */

import { listPublic, cloudEnabled } from './fs.js';

const CACHE_KEY = 'lardo.menuEdits';
const WAIT_MS = 2500; // don't hold the first screen longer than this; the saved copy is used instead

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || []; } catch (e) { return []; }
}

// The edits, fresh when the network answers in time, otherwise the copy saved on this phone.
export async function loadMenuEdits() {
  if (!cloudEnabled()) return [];
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), WAIT_MS));
  try {
    const rows = await Promise.race([listPublic('menu'), timeout]);
    if (!rows) return readCache();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch (e) { /* storage full or blocked */ }
    return rows;
  } catch (e) {
    return readCache();
  }
}

export const productDocId = (productId) => `p_${productId}`;

// Applies the edits to the raw products.json data (changes it in place) and returns
// the products the schedulers hid, so the menu screen can still list them.
export function applyMenuEdits(raw, rows) {
  const products = raw.products || (raw.products = []);
  const byId = new Map(products.map((p) => [p.id, p]));
  const hiddenIds = new Set();

  for (const row of rows) {
    if (!row.id.startsWith('p_')) continue;
    const id = row.id.slice(2);
    let p = byId.get(id);
    if (!p) {
      if (!row.isNew || !row.name || !row.category) continue; // an edit to a product Wolt no longer has
      p = { id, name: row.name, category: row.category, image: null, tags: [], is_new: true };
      products.push(p);
      byId.set(id, p);
    }
    p.edited = true;
    if (row.name) p.name = row.name;
    if (typeof row.description === 'string') p.staff_description = row.description;
    if (typeof row.price === 'number') { p.price = row.price; p.sizes = []; }
    if (row.category) p.category = row.category;
    if (typeof row.pitch === 'string') p.sales = { ...(p.sales || {}), pitch: row.pitch, draft: false };
    if (row.hidden) hiddenIds.add(id);
  }

  const faq = rows.find((r) => r.id === 'faq');
  if (faq && Array.isArray(faq.items)) raw.customer_faq = faq.items.filter((f) => f && f.topic && f.text);

  const tips = rows.find((r) => r.id === 'tips');
  if (tips && Array.isArray(tips.items)) {
    // Product links stay with the tip they belonged to in the snapshot.
    const old = new Map(((raw.sales_situations || {}).items || []).map((t) => [t.id, t]));
    raw.sales_situations = {
      draft: false,
      items: tips.items.filter((t) => t && t.title && t.tip)
        .map((t) => ({ id: t.id, title: t.title, tip: t.tip, products: (old.get(t.id) || {}).products || [] }))
    };
  }

  const hidden = products.filter((p) => hiddenIds.has(p.id));
  raw.products = products.filter((p) => !hiddenIds.has(p.id));
  return hidden;
}
