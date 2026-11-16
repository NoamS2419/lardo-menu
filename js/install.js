/* "Install on your phone": how to add the site to the home screen, so it opens like an app.
   Android Chrome offers its own install prompt (beforeinstallprompt), which we keep for a button.
   iPhone has no prompt: we show the Share → "Add to Home Screen" steps. On iPhone the installed
   app keeps its own storage, so people sign in once more inside it (said in the steps). */

const DISMISS_KEY = 'lardo.installDismissed';
let deferredPrompt = null;

// Called once at startup (main.js), before the browser fires the event.
export function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; document.querySelectorAll('.install-card').forEach((el) => el.remove()); });
}

export const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ua = navigator.userAgent;
const isIOS = () => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/.test(ua);
const dismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; } };

const IOS_STEPS = `
  <ol class="steps">
    <li>לוחצים על כפתור השיתוף (ריבוע עם חץ למעלה). בספארי הוא בתחתית המסך, ב-Chrome ליד שורת הכתובת.</li>
    <li>גוללים ובוחרים <strong>הוספה למסך הבית</strong>, ואז <strong>הוספה</strong>.</li>
    <li>פותחים את <strong>לארדו</strong> ממסך הבית ונכנסים פעם אחת עם שם המשתמש והסיסמה. באייפון האפליקציה לא זוכרת את הכניסה מהדפדפן.</li>
  </ol>`;
const ANDROID_STEPS = `
  <ol class="steps">
    <li>לוחצים על שלוש הנקודות בפינה למעלה.</li>
    <li>בוחרים <strong>התקנת אפליקציה</strong> או <strong>הוספה למסך הבית</strong>, ומאשרים.</li>
    <li>מעכשיו פותחים את <strong>לארדו</strong> ממסך הבית.</li>
  </ol>`;

// The card, or '' when there's nothing to show (installed, a computer, or dismissed).
// beforeSignIn: on the sign-in screen, iPhone users are told to install first and sign up inside the app.
export function installCardHtml({ beforeSignIn = false, force = false } = {}) {
  if (isInstalled() || (!force && dismissed())) return '';
  if (!isIOS() && !isAndroid()) return '';
  if (beforeSignIn && !isIOS()) return ''; // on Android the sign-in carries over, so after sign-up is fine
  const body = isIOS() ? IOS_STEPS : (deferredPrompt ? '<button class="btn btn-wide" type="button" data-install>התקנה</button>' : ANDROID_STEPS);
  return `
    <section class="install-card" aria-labelledby="install-h">
      <h2 id="install-h">${beforeSignIn ? 'כדאי קודם להתקין את האפליקציה' : 'להתקנה בטלפון'}</h2>
      <p>${beforeSignIn ? 'כך הסידור תמיד במסך הבית. אחרי ההתקנה פותחים אותה ונרשמים מתוכה.' : 'כך הסידור והמשמרות נפתחים ממסך הבית, כמו אפליקציה.'}</p>
      ${body}
      <div class="install-actions">
        <button class="btn small" type="button" data-install-close>בוצע</button>
        <button class="btn ghost small" type="button" data-install-close>לא עכשיו</button>
      </div>
    </section>`;
}

export function bindInstallCard(root = document) {
  root.querySelector('[data-install]')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    root.querySelector('.install-card')?.remove();
  });
  // "בוצע" and "לא עכשיו" both hide the card on this phone for good.
  root.querySelectorAll('[data-install-close]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* private mode */ }
    root.querySelector('.install-card')?.remove();
  }));
}
