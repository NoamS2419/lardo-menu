/* "תמונה לוואטסאפ": the published week drawn on a canvas, right to left, in the site's fonts.
   Made on the phone (no outside service); shared with the phone's share sheet, or downloaded. */

import { DAYS, WORK_DAYS, dayDate, short, slotKey } from './week.js';

const W = 1080;
const PAD = 48;

function css(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function wrap(ctx, text, max) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export async function drawWeek(branch0, week, sched) {
  const branch = sched && sched.shifts ? { ...branch0, shifts: sched.shifts, hours: sched.hours || {} } : branch0;
  // Light colors always: the image is shared into chats, whatever the phone's theme.
  const ink = '#2A211C'; const muted = '#6B625C'; const line = '#E2E0DC'; const copper = '#9A5B3C'; const closed = '#EEEDEA';
  const display = css('--display', 'serif');
  const font = css('--font', 'sans-serif');
  try { await Promise.all([document.fonts.load(`500 40px ${display}`), document.fonts.load(`400 28px ${display}`)]); } catch (e) { /* default font */ }

  const shifts = branch.shifts;
  const dayCol = 200;
  const colW = (W - PAD * 2 - dayCol) / shifts.length;
  const lineH = 38;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `400 28px ${font}`;
  const rows = WORK_DAYS.map((dow) => {
    const cells = shifts.map((s) => {
      const k = slotKey(dow, s.id);
      const people = (sched.slots || {})[k] || [];
      const need = Number((sched.need || {})[k] ?? branch.need[k] ?? 0);
      const names = people.map((p) => (p.start ? `${p.name} ${p.start}` : p.name));
      const lines = names.flatMap((n) => wrap(measure, n, colW - 24));
      return { closed: !need && !people.length, lines };
    });
    const h = Math.max(88, 24 + Math.max(1, ...cells.map((c) => c.lines.length)) * lineH);
    return { dow, cells, h };
  });
  const headH = 210; const colHeadH = 80;
  const H = headH + colHeadH + rows.reduce((a, r) => a + r.h, 0) + PAD;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.direction = 'rtl';
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
  const right = W - PAD;

  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = copper; ctx.font = `600 26px ${font}`;
  ctx.fillText(branch.name, right, PAD + 26);
  ctx.fillStyle = ink; ctx.font = `500 54px ${display}`;
  ctx.fillText('סידור עבודה', right, PAD + 92);
  ctx.fillStyle = muted; ctx.font = `400 30px ${font}`;
  ctx.fillText(`שבוע ${short(week)} עד ${short(dayDate(week, 5))}`, right, PAD + 136);

  let y = headH;
  ctx.font = `600 28px ${font}`;
  shifts.forEach((s, i) => {
    const x = right - dayCol - i * colW - 12;
    ctx.fillStyle = ink; ctx.fillText(s.name, x, y + 34);
    ctx.fillStyle = muted; ctx.font = `400 24px ${font}`;
    ctx.direction = 'ltr'; ctx.fillText(`${s.start}–${s.end}`, x, y + 66); ctx.direction = 'rtl';
    ctx.font = `600 28px ${font}`;
  });
  y += colHeadH;

  for (const r of rows) {
    ctx.strokeStyle = line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
    ctx.fillStyle = ink; ctx.font = `500 34px ${display}`;
    ctx.fillText(DAYS[r.dow], right, y + 46);
    ctx.fillStyle = muted; ctx.font = `400 24px ${font}`;
    ctx.fillText(short(dayDate(week, r.dow)), right, y + 78);
    r.cells.forEach((cell, i) => {
      const x = right - dayCol - i * colW;
      if (cell.closed) {
        ctx.fillStyle = closed; ctx.fillRect(x - colW, y + 1, colW, r.h - 1);
        ctx.fillStyle = muted; ctx.font = `400 26px ${font}`; ctx.fillText('סגור', x - 12, y + 46);
        return;
      }
      ctx.fillStyle = ink; ctx.font = `400 28px ${font}`;
      cell.lines.forEach((t, j) => ctx.fillText(t, x - 12, y + 44 + j * lineH));
    });
    y += r.h;
  }
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  return c;
}

export async function shareImage(branch, week, sched) {
  const canvas = await drawWeek(branch, week, sched);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], `schedule-${week}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'סידור עבודה' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
