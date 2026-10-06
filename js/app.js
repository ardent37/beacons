/* ==========================================================================
   Salty · link in bio
   ========================================================================== */

const CONFIG = {
  // URL de tu Worker de Cloudflare (contador en tiempo real). Déjalo vacío
  // y la web usará data/followers.json, que GitHub actualiza cada 30 min.
  // Ejemplo: 'https://salty-followers.tu-usuario.workers.dev'
  apiUrl: 'https://salty-followers.ardentcone.workers.dev/',
  fallbackUrl: 'data/followers.json',
  refreshMs: 30_000,
};

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ──────────────────────────────────────────────────────────────────────────
   Contador de seguidores (odómetro)
   ────────────────────────────────────────────────────────────────────────── */

const storage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

const CACHE_KEY = 'salty:followers';

function createCounter(el) {
  const fmt = new Intl.NumberFormat('es-ES'); // 5263 · 10.942 · 125.300
  const DIGITS = '<span>0</span><span>1</span><span>2</span><span>3</span><span>4</span>'
               + '<span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>0</span>';
  let value = 0;
  let cols = [];
  let raf = 0;

  // Monta una columna giratoria por cada cifra
  function build(n) {
    const str = fmt.format(n);
    let place = str.replace(/\D/g, '').length - 1;
    const frag = document.createDocumentFragment();
    cols = [];
    for (const ch of str) {
      if (ch >= '0' && ch <= '9') {
        const col = document.createElement('span');
        const strip = document.createElement('span');
        col.className = 'counter__col';
        strip.className = 'counter__strip';
        strip.innerHTML = DIGITS;
        col.append(strip);
        frag.append(col);
        cols.push({ col, strip, place: place-- });
      } else {
        const sep = document.createElement('span');
        sep.className = 'counter__sep';
        sep.textContent = ch;
        frag.append(sep);
      }
    }
    el.replaceChildren(frag);
  }

  const digitAt = (n, place) => Math.floor(n / 10 ** place) % 10;

  function paint(positions) {
    for (const c of cols) {
      const p = ((positions[c.place] % 10) + 10) % 10;
      c.strip.style.transform = `translate3d(0, ${-p}em, 0)`;
    }
  }

  function label(n) {
    el.setAttribute('aria-label', `${fmt.format(n)} seguidores`);
  }

  function set(n) {
    cancelAnimationFrame(raf);
    value = n;
    build(n);
    paint(Object.fromEntries(cols.map((c) => [c.place, digitAt(n, c.place)])));
    label(n);
  }

  function animateTo(to) {
    const from = value;
    if (to === from) return;
    if (reduceMotion.matches) return set(to);

    cancelAnimationFrame(raf);
    value = to;
    label(to);

    const fromLen = String(from).length;
    if (String(to).length !== cols.length) build(to);

    // Para cada cifra: desde qué número sale y cuántos pasos gira.
    // Las cifras bajas giran más que las altas, como un cuentakilómetros real.
    const plan = cols.map((c) => {
      const start = digitAt(from, c.place);
      const end = digitAt(to, c.place);
      let steps = Math.floor(to / 10 ** c.place) - Math.floor(from / 10 ** c.place);
      if (Math.abs(steps) > 20) {
        const dir = Math.sign(steps);
        steps = dir * (20 + ((((end - start) * dir) % 10) + 10) % 10);
      }
      return { ...c, start, steps, appearing: c.place >= fromLen };
    });

    const delta = Math.abs(to - from);
    const duration = Math.min(2200, 800 + 120 * Math.log2(1 + delta));
    const ease = (t) => 1 - (1 - t) ** 4;

    const render = (e) => {
      paint(Object.fromEntries(plan.map((p) => [p.place, p.start + p.steps * e])));
      for (const p of plan) if (p.appearing) p.col.style.opacity = e;
    };
    render(0); // pinta ya el punto de partida, sin parpadeos

    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      render(ease(t));
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  return {
    get value() { return value; },
    set,
    animateTo,
  };
}

async function getJSON(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Combina red a red: si el Worker no consigue Instagram (Instagram suele
// bloquear a Cloudflare), se usa el dato de data/followers.json para esa red.
async function fetchFollowers() {
  const [live, backup] = await Promise.all([
    CONFIG.apiUrl ? getJSON(CONFIG.apiUrl) : null,
    getJSON(`${CONFIG.fallbackUrl}?t=${Date.now()}`),
  ]);
  const pick = (key) => {
    const n = Number(live?.[key] ?? backup?.[key]);
    return Number.isFinite(n) ? n : null;
  };
  const tiktok = pick('tiktok');
  const instagram = pick('instagram');
  if (tiktok == null && instagram == null) return null;
  return (tiktok ?? 0) + (instagram ?? 0);
}

function initFollowers() {
  const el = document.getElementById('followers');
  if (!el) return;

  const counter = createCounter(el);
  const cached = storage.get(CACHE_KEY);
  counter.set(Number(cached?.total) || Number(el.dataset.value) || 0);

  let timer = 0;

  async function refresh() {
    const total = await fetchFollowers();
    if (total != null) {
      counter.animateTo(total);
      storage.set(CACHE_KEY, { total, at: Date.now() });
    }
  }

  function start() {
    clearInterval(timer);
    refresh();
    timer = setInterval(refresh, CONFIG.refreshMs);
  }

  // Solo consulta mientras la pestaña está visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(timer);
    else start();
  });

  // Deja que termine la animación de entrada antes del primer giro
  setTimeout(start, 450);
}

/* ──────────────────────────────────────────────────────────────────────────
   Ventana de registro (iframe superpuesto)
   ────────────────────────────────────────────────────────────────────────── */

function initSheet() {
  const promo = document.getElementById('promo');
  const sheet = document.getElementById('sheet');
  const panel = document.getElementById('sheet-panel');
  const bar = document.getElementById('sheet-bar');
  const body = document.getElementById('sheet-body');
  const page = document.getElementById('page');
  const backdrop = sheet.querySelector('.sheet__backdrop');
  const closeBtn = sheet.querySelector('.sheet__close');
  const mobile = matchMedia('(max-width: 639px)');
  const HASH = '#registro';

  let iframe = null;
  let isOpen = false;
  let pushed = false;
  let lastFocus = null;
  let unlockTimer = 0;

  // Crea el iframe en cuanto el usuario muestra intención (hover / toque),
  // así la web ya está cargando cuando la hoja termina de subir.
  function ensureIframe() {
    if (iframe) return;
    iframe = document.createElement('iframe');
    iframe.src = promo.href;
    iframe.title = 'Registro en USFans';
    iframe.allow = 'clipboard-read; clipboard-write; payment';
    iframe.addEventListener('load', () => body.classList.add('is-loaded'), { once: true });
    body.append(iframe);
  }

  function open({ push = true } = {}) {
    if (isOpen) return;
    isOpen = true;
    clearTimeout(unlockTimer);
    lastFocus = document.activeElement;
    ensureIframe();

    // La página se encoge hacia el centro de lo que se ve en pantalla
    page.style.transformOrigin = `50% ${scrollY + innerHeight / 2}px`;
    root.classList.add('is-locked', 'sheet-open');
    sheet.classList.add('is-open');
    sheet.removeAttribute('aria-hidden');

    if (push) {
      history.pushState({ sheet: true }, '', HASH);
      pushed = true;
    }
    setTimeout(() => closeBtn.focus({ preventScroll: true }), 350);
  }

  function close({ fromHistory = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    sheet.classList.remove('is-open', 'is-dragging');
    root.classList.remove('sheet-open');
    sheet.setAttribute('aria-hidden', 'true');
    panel.style.transform = '';
    backdrop.style.opacity = '';

    unlockTimer = setTimeout(() => root.classList.remove('is-locked'), 500);
    const target = lastFocus && lastFocus !== document.body ? lastFocus : promo;
    target.focus({ preventScroll: true });

    if (!fromHistory) {
      if (pushed) history.back();
      else if (location.hash === HASH) history.replaceState(null, '', location.pathname + location.search);
    }
    pushed = false;
  }

  promo.addEventListener('click', (e) => {
    // Ctrl/Cmd + clic sigue abriendo en pestaña nueva
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    open();
  });
  promo.addEventListener('pointerenter', ensureIframe, { once: true });
  promo.addEventListener('touchstart', ensureIframe, { once: true, passive: true });
  promo.addEventListener('focus', ensureIframe, { once: true });

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });

  // Botón "atrás" del móvil cierra la ventana en vez de salir de la web
  addEventListener('popstate', () => {
    if (isOpen) close({ fromHistory: true });
  });

  document.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const items = [...sheet.querySelectorAll('a[href], button, iframe')];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Arrastrar la barra hacia abajo para cerrar (móvil)
  let drag = null;

  bar.addEventListener('pointerdown', (e) => {
    if (!mobile.matches || !isOpen || e.target.closest('a, button')) return;
    drag = { y0: e.clientY, y: e.clientY, t: e.timeStamp, v: 0, dy: 0, h: panel.offsetHeight };
    bar.setPointerCapture(e.pointerId);
    sheet.classList.add('is-dragging');
  });

  bar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const raw = e.clientY - drag.y0;
    const dy = raw < 0 ? raw * 0.12 : raw; // resistencia al tirar hacia arriba
    const dt = Math.max(1, e.timeStamp - drag.t);
    drag.v = (e.clientY - drag.y) / dt;
    drag.y = e.clientY;
    drag.t = e.timeStamp;
    drag.dy = dy;
    panel.style.transform = `translate3d(0, ${dy}px, 0)`;
    backdrop.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / drag.h));
  });

  const endDrag = () => {
    if (!drag) return;
    const { dy, v, h } = drag;
    drag = null;
    sheet.classList.remove('is-dragging');
    if (dy > h * 0.22 || v > 0.55) {
      close();
    } else {
      panel.style.transform = '';
      backdrop.style.opacity = '';
    }
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  // Enlace directo: tuweb.com/#registro abre la ventana al entrar
  if (location.hash === HASH) open({ push: false });
  addEventListener('hashchange', () => {
    if (location.hash === HASH && !isOpen) open({ push: false });
  });
}

/* ──────────────────────────────────────────────────────────────────────────
   Botón de Telegram: enlace directo según el país
   ────────────────────────────────────────────────────────────────────────── */

// El país se pide nada más cargar, así el botón ya lleva directo al grupo
// correcto, sin páginas intermedias. Se abre en la misma pestaña: el móvil
// pasa el enlace a la app de Telegram y la web se queda tal cual detrás.
// Si algo falla, el botón sigue apuntando a /chats/, que hace lo mismo.
function initChats() {
  const tile = document.getElementById('tile-chats');
  if (!tile || !window.SaltyChats) return;
  tile.href = SaltyChats.linkFor(null); // provisional: por zona horaria
  SaltyChats.getCountry(4000).then((country) => {
    if (country) tile.href = SaltyChats.linkFor(country);
  });
}

initFollowers();
initSheet();
initChats();
