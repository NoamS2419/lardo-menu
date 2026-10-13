/* Small celebrations: confetti bursts and counting numbers. All skipped under reduced motion. */

import { prefersReducedMotion } from './core.js';

const COLORS = ['#8C2F39', '#B8862B', '#E9C46A', '#E7A3B1', '#7FA36B', '#D98E4A'];

// Confetti flying out of an element (or the middle of the screen).
export function burst(from, count = 26) {
  if (prefersReducedMotion()) return;
  const r = from ? from.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, width: 0, height: 0 };
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 110;
    s.style.left = `${r.left + r.width / 2}px`;
    s.style.top = `${r.top + r.height / 2}px`;
    s.style.background = COLORS[i % COLORS.length];
    s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(angle) * dist - 40}px`);
    s.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    s.style.setProperty('--delay', `${Math.random() * 80}ms`);
    if (i % 3 === 0) s.classList.add('round');
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1400);
}

// A bigger shower from the top for a great result.
export function shower() {
  if (prefersReducedMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('span');
    s.className = 'fall';
    s.style.left = `${Math.random() * 100}vw`;
    s.style.background = COLORS[i % COLORS.length];
    s.style.setProperty('--rot', `${Math.random() * 900 - 450}deg`);
    s.style.setProperty('--delay', `${Math.random() * 700}ms`);
    s.style.setProperty('--dur', `${1600 + Math.random() * 1200}ms`);
    s.style.setProperty('--drift', `${Math.random() * 80 - 40}px`);
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3800);
}

// Counts an element's number up from 0 to `to`.
export function countUp(el, to, ms = 900) {
  if (!el) return;
  if (prefersReducedMotion() || to <= 0) { el.textContent = String(to); return; }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / ms);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
