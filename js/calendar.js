/* "הוספה ליומן": turns my upcoming shifts into a calendar file (.ics) that the phone opens in its
   calendar app. Made in the browser, nothing is sent anywhere. Each shift has a fixed id, so
   adding the file again after a change updates the shift instead of adding a second one
   (on most calendar apps). */

import { israelTime } from './week.js';

// "9" / "9:30" / "06:30" -> minutes after midnight, or null.
function minutesOf(text) {
  const m = /^(\d{1,2})(?::(\d\d))?$/.exec(String(text || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null;
}

// 2026-11-22T04:30:00Z -> 20261122T043000Z
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
// Commas, semicolons and backslashes have a meaning in .ics text.
const text = (s) => String(s).replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

// shifts: the list from myShifts() in shifts.js ({ date, shift, hours, start }).
export function shiftsIcs(shifts, uid, placeName) {
  const now = stamp(new Date());
  const events = shifts.map((x) => {
    const startMin = minutesOf(x.start) ?? minutesOf(x.hours.start);
    let endMin = minutesOf(x.hours.end);
    if (startMin == null || endMin == null) return '';
    if (endMin <= startMin) endMin = startMin + 60; // odd hours: keep the event valid
    return [
      'BEGIN:VEVENT',
      `UID:${x.date}-${x.shift.id}-${uid}@lardo-shifts`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(israelTime(x.date, startMin))}`,
      `DTEND:${stamp(israelTime(x.date, endMin))}`,
      `SUMMARY:${text(`משמרת ${x.shift.name}`)}`,
      `LOCATION:${text(placeName)}`,
      'END:VEVENT'
    ].join('\r\n');
  }).filter(Boolean);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//lardo//shifts//HE', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}

// Hands the file to the phone's calendar.
// iPhone: opening a text/calendar address shows the calendar's own "add all" screen (a download
// would land in the Files app instead). Elsewhere (Android, computers) the file is downloaded and
// opens in the calendar app from the download notice.
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export function openIcs(ics, fileName = 'shifts.ics') {
  if (isIOS()) {
    location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    return;
  }
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
