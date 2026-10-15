# נתוני המוצרים

`data/products.json` נוצר מכאן. לא לערוך אותו ידנית.

| קובץ | מה זה |
|---|---|
| `wolt_snapshot.tsv` | העתק גולמי של וולט, שורה למוצר (נוצר ע"י `fetch_wolt.py`) |
| `staff_overlay.json` | מה שהעובדות הוסיפו או תיקנו. גובר על וולט. **עורכים ידנית**. כולל `sales_tips`: טיפים למכירה (טיוטה, `draft: true`; כשהטיפים מאושרים משנים ל־`false`) |
| `build.py` | ממזג את שניהם ל־`data/products.json` |
| `fetch_wolt.py` | מושך מוולט מחדש ומריץ את `build.py`. עם `--images` מוריד גם תמונות חסרות ל־`data/images/<id>-<hash>.webp` (רוחב 500; ה־hash הוא של כתובת התמונה בוולט, כך שתמונה שהוחלפה בוולט יורדת מחדש) ומוחק תמונות שאף מוצר לא משתמש בהן. תמונה שנכשלה מדולגת עם אזהרה |

## רענון ("תעדכן")

1. **GitHub:** לשונית Actions ← "Refresh from Wolt" ← Run workflow. נפתח PR עם השינויים ועם אזהרות, אם יש.
   (פעם אחת: Settings ← Actions ← General ← לסמן "Allow GitHub Actions to create and approve pull requests". את Workflow permissions משאירים על "Read repository contents"; ה־workflow מבקש הרשאת כתיבה בעצמו.)
2. **ממחשב:** `pip install pillow && python3 tools/fetch_wolt.py --images`.
3. **מ־Claude בענן:** wolt.com חסום שם, אבל WebFetch עובד לכל קטגוריה בנפרד:
   `https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/lart-du-pain-r/assortment/categories/slug/menucategory-<N>?language=he`.
   מעדכנים את `wolt_snapshot.tsv` ומריצים `python3 tools/build.py`.

## בדיקות

`fetch_wolt.py` נעצר בלי לשנות כלום אם וולט החזיר פחות מ־80% מהמוצרים של ה־snapshot הקודם (תשובה חלקית).

### ב־build

`build.py` מדפיס `WARNING` על כל רשומה ב־`staff_overlay.json` שכבר לא מתאימה ל־snapshot: מזהה שוולט שינה (ואז תגיות כמו חלב נוכרי או הריון לא מוחלות), קטגוריה לא קיימת או מפתח לא מוכר. עם `--strict` הוא נכשל. מוצר שנעלם או שינה שם מאז ה־build הקודם מודפס כ־`note`.
כשמוצר מקבל מזהה חדש: מעבירים את הרשומה שלו ב־`staff_overlay.json` למזהה החדש.

`updated` ב־products.json מתעדכן רק כשהתוכן השתנה, כך שאפשר להשתמש בו כגרסת מטמון.

## מבנה `products.json`

```jsonc
{
  "updated": "2026-10-13",
  "categories": [{"id": "pastries", "name": "מאפים", "count": 28}, ...],   // בסדר התצוגה
  "products": [{
    "id": "220523a6...",            // מזהה וולט, או "staff-..." למוצרי דלפק
    "category": "pastries",         // categories[].id
    "category_name": "מאפים",
    "name": "פאן סוויס",
    "unit": null,                    // "אישי" / "1 יח׳" כשבוולט כתוב "שם | אישי"
    "aliases": [],                   // שמות נוספים שהעובדים משתמשים בהם
    "description": "...",           // מרכיבים: מוולט, או מתוקן לפי העובדות
    "staff_description": "...",     // ההסבר של העובדת, או null
    "ingredients": ["..."],          // פירוק גס של description למשחק "ממה זה עשוי?"
    "price": 38,                     // ₪. עם גדלים: מחיר הגודל הקטן. null = לא ידוע
    "sizes": [{"label": "קוטר 16", "price": 150}],
    "choices": ["פטל", "פיסטוק"],    // טעמים לבחירה
    "image": "images/<id>-<hash>.webp" | "https://imageproxy.wolt.com/..." | null,
    "ai_image": false,               // true = התמונה בוולט נוצרה ב־AI (עם תווית). לא להשתמש בה במשחקים ובשערים
    "tags": ["חלב נוכרי"],
    "notes": [],
    "source": "wolt" | "wolt+staff" | "staff",
    "is_wolt": true,                 // false = נמכר רק בדלפק
    "wolt": {...} | null             // הנתונים המקוריים מוולט, לעיון
  }],
  "customer_faq": [{"topic": "שמירה והובלה", "text": "..."}],
  "sales_situations": {               // טיפים לפי מצב של לקוח
    "draft": true,                    // טיוטה: עדיין לא אושר ע"י שרון
    "items": [{"id": "travel", "title": "לנסיעה", "tip": "...", "products": [{"id": "...", "name": "..."}]}]   // not-sweet, small-addon, lunch, travel, hosting, gift, fruity, allergy
  }
}
```

בכל מוצר יש גם `sales` (או null):

```jsonc
"sales": {
  "pair_with": [{"id": "...", "name": "תפוזים"}],   // מה להציע ליד
  "pitch": "שורה אחת איך להמליץ" | null,
  "draft": true
}
```
