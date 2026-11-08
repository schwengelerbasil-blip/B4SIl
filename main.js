import { createScene } from './vinyl.js';
import { initPlayers } from './players.js';
import { clamp, lerp } from './mat.js';

const EMAIL = 'b4ilmixmastering@gmail.com';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------ shared state */
const S = { y: 0, target: 0, dy: 0, max: 1, stops: [0, 1, 2, 3, 4], px: 0, py: 0, tpx: 0, tpy: 0 };

function computeStops() {
  const vh = window.innerHeight;
  S.max = Math.max(1, document.documentElement.scrollHeight - vh);
  const els = [...document.querySelectorAll('[data-stop]')];
  const stops = els.map((el, i) => {
    if (i === 0) return 0;
    if (i === els.length - 1) return S.max;
    const r = el.getBoundingClientRect();
    return clamp(r.top + window.scrollY + r.height / 2 - vh / 2, 0, S.max);
  });
  for (let i = 1; i < stops.length; i++) stops[i] = Math.max(stops[i], stops[i - 1] + 1);
  S.stops = stops;
}

let stopsQueued = false;
function queueStops() {
  if (stopsQueued) return;
  stopsQueued = true;
  requestAnimationFrame(() => { stopsQueued = false; computeStops(); });
}
window.addEventListener('resize', queueStops);
window.addEventListener('load', queueStops);
new ResizeObserver(queueStops).observe(document.body);
document.querySelectorAll('img').forEach((img) => img.addEventListener('load', queueStops));
computeStops();

window.addEventListener('scroll', () => { S.target = window.scrollY; }, { passive: true });
S.target = S.y = window.scrollY;

window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  S.tpx = (e.clientX / window.innerWidth) * 2 - 1;
  S.tpy = (e.clientY / window.innerHeight) * 2 - 1;
}, { passive: true });

/* ------------------------------------------------------------ text reveals */
function splitWords(el) {
  const text = el.textContent.trim();
  el.setAttribute('aria-label', text);
  el.textContent = '';
  text.split(/\s+/).forEach((word, i, all) => {
    const w = document.createElement('span');
    w.className = 'w';
    w.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('span');
    inner.className = 'wi';
    inner.style.setProperty('--wi', i);
    inner.textContent = word;
    w.appendChild(inner);
    el.appendChild(w);
    if (i < all.length - 1) el.appendChild(document.createTextNode(' '));
  });
}
document.querySelectorAll('[data-split]').forEach(splitWords);

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }
}, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
document.querySelectorAll('[data-reveal], [data-split]').forEach((el) => io.observe(el));

/* ------------------------------------------------------------ DOM bits */
const nav = document.getElementById('nav');
const glowIce = document.querySelector('.atmo__glow--ice');
const glowCoral = document.querySelector('.atmo__glow--coral');
const shots = [...document.querySelectorAll('[data-parallax]')];
document.getElementById('year').textContent = new Date().getFullYear();

function updateDom(p, lights) {
  nav.classList.toggle('is-scrolled', S.y > 40);
  // lighting drifts across the page: ice glow travels down-right, coral glow rises into the contact area
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  glowIce.style.transform = `translate3d(${p * vw * 0.28}px, ${p * vh * 0.55}px, 0)`;
  glowIce.style.opacity = String(lerp(1, 0.55, p));
  glowCoral.style.transform = `translate3d(${-p * vw * 0.34}px, ${-p * vh * 0.62}px, 0)`;
  glowCoral.style.opacity = String(lerp(0.75, 1, p));
  if (lights) { /* reserved for per-frame light data */ }
  // gentle depth parallax on the studio photos
  if (!reduced) {
    for (const el of shots) {
      const r = el.getBoundingClientRect();
      const c = (r.top + r.height / 2 - vh / 2) / vh;
      el.style.setProperty('--py', `${c * parseFloat(el.dataset.parallax) * -420}px`);
    }
  }
}

/* ------------------------------------------------------------ contact */
const form = document.getElementById('contact-form');
const emailInput = document.getElementById('email');
const msg = document.getElementById('contact-msg');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = emailInput.value.trim();
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  form.classList.toggle('is-error', !ok);
  if (!ok) {
    msg.textContent = 'Please enter a valid email address.';
    emailInput.focus();
    return;
  }
  msg.textContent = 'Opening your email app…';
  const subject = 'Mix & Mastering inquiry';
  const body = `Hi B4SIL,\n\nI have a track I'd like to work on.\n\nMy email: ${value}\n\n`;
  window.location.href = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});
emailInput.addEventListener('input', () => { form.classList.remove('is-error'); msg.textContent = ''; });

/* ------------------------------------------------------------ audio */
initPlayers();

/* ------------------------------------------------------------ 3D scene + loop */
let scene = null;
const canvas = document.getElementById('scene');

function setFallback(on) { document.documentElement.classList.toggle('no-webgl', on); }

createScene(canvas, setFallback)
  .then((s) => { scene = s; if (!s) setFallback(true); })
  .catch((err) => { console.warn('3D scene unavailable, using fallback:', err.message); setFallback(true); });

let last = performance.now();
const t0 = last;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const prev = S.y;
  S.y = reduced ? S.target : lerp(S.y, S.target, 1 - Math.exp(-dt * 6.5));
  if (Math.abs(S.y - S.target) < 0.05) S.y = S.target;
  S.dy = S.y - prev;
  const k = 1 - Math.exp(-dt * 4);
  S.px = lerp(S.px, S.tpx, k);
  S.py = lerp(S.py, S.tpy, k);

  let info = null;
  if (scene) info = scene.render(dt, (now - t0) / 1000, S);
  updateDom(clamp(S.y / S.max), info);
}
requestAnimationFrame(frame);
