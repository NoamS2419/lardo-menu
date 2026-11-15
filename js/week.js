/* Dates for the shifts system. Everything is in Israel time; a week is named by the date of its
   Sunday ("2026-11-22"), and a slot by its day (0 = Sunday … 5 = Friday) and shift id ("0m", "5e"). */

export const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const WORK_DAYS = [0, 1, 2, 3, 4, 5]; // Saturday closed

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
function parts(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const utcDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export const today = (now = new Date()) => parts(now).iso;
export const addDays = (iso, n) => isoOf(utcDay(iso) + n * 864e5);
export const dowOf = (iso) => new Date(utcDay(iso)).getUTCDay();
export const weekOf = (iso) => addDays(iso, -dowOf(iso));
export const thisWeek = (now) => weekOf(today(now));
export const nextWeek = (now) => addDays(thisWeek(now), 7);
export const dayDate = (week, dow) => addDays(week, dow);

// Keeps "8–13.11" and "06:30–14:30" in reading order inside Hebrew text (LRI … PDI).
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
export const ltr = (s) => `${LRI}${s}${PDI}`;
export const timeRange = (a, b) => ltr(`${a}–${b}`);

// "22.11"
export const short = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}`; };
// "22–27.11" (or "29.11–4.12") as plain text, and as HTML that stays in one piece inside Hebrew.
export const weekRangeText = (week) => {
  const end = addDays(week, 5);
  return week.slice(5, 7) === end.slice(5, 7) ? `${Number(week.slice(8))}–${short(end)}` : `${short(week)}–${short(end)}`;
};
export const weekRange = (week) => `<bdi dir="ltr" class="nw">${weekRangeText(week)}</bdi>`;

// The moment a wall-clock time in Israel happens (handles summer time).
export function israelTime(iso, minutes) {
  let guess = utcDay(iso) + minutes * 60000 - 2 * 36e5;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess));
    const diff = (utcDay(p.iso) + p.minutes * 60000) - (utcDay(iso) + minutes * 60000);
    if (!diff) break;
    guess -= diff;
  }
  return new Date(guess);
}

// Submission for `week` closes on closeDow of the week before, closeMin minutes after midnight (1440 = end of day).
export const closesAt = (branch, week) => israelTime(addDays(week, -7 + branch.closeDow), branch.closeMin);

// "עד סוף יום רביעי" / "עד יום רביעי בשעה 20:00"
export function deadlineText(branch) {
  const day = DAYS[branch.closeDow];
  if (branch.closeMin === 1440) return `עד סוף יום ${day}`;
  const h = String(Math.floor(branch.closeMin / 60)).padStart(2, '0');
  const m = String(branch.closeMin % 60).padStart(2, '0');
  return `עד יום ${day} בשעה ${h}:${m}`;
}

// About 3 months of keeping things, counted from the end of the week.
export const expiry = (week) => new Date(utcDay(week) + (7 + 90) * 864e5);

// Documents for one branch's week are named "<branch>_<week>", e.g. "raanana_2026-11-22".
export const weekId = (branch, week) => `${branch}_${week}`;

export const slotKey = (dow, shiftId) => `${dow}${shiftId}`;

// A shift's hours on a given day (a slot can override the branch's usual hours, e.g. Friday).
export function hoursOf(branch, dow, shift) {
  const o = branch.hours && branch.hours[slotKey(dow, shift.id)];
  if (typeof o === 'string' && /^\d\d:\d\d-\d\d:\d\d$/.test(o)) { const [start, end] = o.split('-'); return { start, end }; }
  return { start: shift.start, end: shift.end };
}

// Slots that run this week: need > 0. `need` may come from a published week, else the branch.
export function openSlots(branch, need = branch.need) {
  const out = [];
  for (const dow of WORK_DAYS) {
    for (const s of branch.shifts) {
      const k = slotKey(dow, s.id);
      if (Number((need || {})[k] ?? 0) > 0) out.push({ key: k, dow, shift: s });
    }
  }
  return out;
}

// "הלילה בחצות" / "מחר בשעה 20:00" when submission for `week` closes today or tomorrow, else ''.
export function closingSoonText(branch, week, now = new Date()) {
  const closeDay = addDays(week, -7 + branch.closeDow);
  const t = today(now);
  const day = closeDay === t ? 'היום' : closeDay === addDays(t, 1) ? 'מחר' : '';
  if (!day) return '';
  if (branch.closeMin >= 1440) return day === 'היום' ? 'הלילה בחצות' : 'מחר בחצות הלילה';
  const h = String(Math.floor(branch.closeMin / 60)).padStart(2, '0');
  return `${day} בשעה ${ltr(`${h}:${String(branch.closeMin % 60).padStart(2, '0')}`)}`;
}
