# לארדו תפריט

אתר פנימי ללימוד המוצרים לעובדי הסניף. אתר סטטי (HTML/CSS/JS בלי בנייה), יושב על GitHub Pages.

- `data/products.json` — כל המוצרים. נוצר ע"י `tools/build.py` משליפת וולט + הערות הצוות; לא לערוך ידנית. רענון ומבנה: [tools/README.md](tools/README.md).
- `data/images/` — תמונות המוצרים (מורדות ע"י ה־Action "Refresh from Wolt").
- `js/main.js` — נקודת הכניסה: טעינת הנתונים, ניתוב בין דפים, תמונה חלופית.
- `js/catalog.js` — קטלוג, קטגוריות, דף מוצר, חיפוש, דפי מידע.
- `js/learn.js` — כרטיסיות ומשחקים.
- `js/progress.js` — התקדמות אישית (נשמרת רק בטלפון).
- `js/team.js`, `js/cloud.js` — טבלת הצוות דרך Firebase (REST, בלי SDK). כבויה כל עוד `js/config.js` ריק; הכללים ב־`firestore.rules`.
- `js/core.js` — מצב משותף ועזרי עיצוב; `js/fx.js` — אנימציות חגיגה (מושבתות ב־reduced motion).

בלי Analytics ובלי עוגיות. חסום לאינדוקס בגוגל (`noindex`).

הרצה מקומית: `python3 -m http.server` ולפתוח את `http://localhost:8000`.

## טבלת הצוות: תחזוקה ידנית

מי שמחק את נתוני הדפדפן או החליף טלפון מקבל זהות חדשה, והכינוי הישן שלו נשאר תפוס. כדי לשחרר אותו:

1. נכנסים ל־[Firebase console](https://console.firebase.google.com/) → הפרויקט → **Firestore Database**.
2. באוסף `names` פותחים את המסמך של הכינוי (שם המסמך הוא הכינוי באותיות קטנות) ומעתיקים את ה־`uid` שבו.
3. מוחקים את המסמך `names/<כינוי>`, את `players/<uid>`, ובאוסף `daily` את המסמכים שמתחילים בתאריך ונגמרים ב־`_<uid>`.
4. אפשר גם למחוק את המשתמש האנונימי ב־**Authentication → Users** לפי אותו `uid`.

תוצאות האתגר היומי נמחקות לבד אחרי 60 יום, בתנאי שמוגדרת מדיניות TTL על השדה `daily.expireAt` (Firestore → TTL).
