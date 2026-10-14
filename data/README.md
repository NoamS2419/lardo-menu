# data/

`products.json` נוצר ע"י `tools/build.py`. לא לערוך ידנית. המבנה המלא ב־[tools/README.md](../tools/README.md).

## טיפים למכירה (טיוטה)

מקור: `tools/staff_overlay.json`, תחת `sales_tips`.

- `products[].sales`: `{ "pair_with": [{ "id", "name" }], "pitch": string | null, "draft": boolean }`, או `null`.
  - `pair_with`: מה להציע ליד המוצר.
  - `pitch`: שורה אחת איך להמליץ.
- `sales_situations`: `{ "draft": boolean, "items": [{ "id", "title", "tip", "products": [{ "id", "name" }] }] }`.
  - מזהי המצבים: `not-sweet`, `travel`, `hosting`, `gift`, `fruity`.
- `draft: true` אומר שהטיפים עוד לא אושרו. כשמאשרים, משנים ל־`false` ב־`staff_overlay.json` ומריצים `python3 tools/build.py`.

`images/`: תמונות המוצרים (`<id>-<hash>.webp`), מורדות ע"י ה־Action "Refresh from Wolt".
