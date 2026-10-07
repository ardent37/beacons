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

// Estadísticas (Umami). Se carga en paralelo para no frenar la web; los eventos
// que lleguen antes se guardan y se envían al cargar. Si un bloqueador lo
// impide, no pasa nada.
const trackQueue = [];
function track(name, data) {
  if (typeof window.umami?.track === 'function') {
    try { window.umami.track(name, data); } catch {}
  } else {
    trackQueue.push([name, data]);
  }
}
document.getElementById('umami-script')?.addEventListener('load', () => {
  for (const [name, data] of trackQueue.splice(0)) track(name, data);
});
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
  const desktop = matchMedia('(min-width: 980px)');
  const deskPhone = document.getElementById('desk-phone');
  const deskBody = document.getElementById('desk-body');
  const HASH = '#registro';

  let iframe = null;
  let isOpen = false;
  let pushed = false;
  let lastFocus = null;
  let unlockTimer = 0;

  // Monta el iframe de USFans en la hoja (móvil) o en el marco (ordenador).
  // En móvil se crea en cuanto el usuario muestra intención (hover / toque),
  // así la web ya está cargando cuando la hoja termina de subir.
  function ensureIframe(container = desktop.matches ? deskBody : body) {
    if (iframe?.parentElement === container) return;
    if (iframe) {
      iframe.parentElement.classList.remove('is-loaded');
      iframe.remove(); // al cambiar el tamaño de la ventana entre móvil y ordenador
    }
    iframe = document.createElement('iframe');
    iframe.src = promo.href;
    iframe.title = 'Registro en USFans';
    iframe.allow = 'clipboard-read; clipboard-write; payment';
    iframe.addEventListener('load', () => container.classList.add('is-loaded'), { once: true });
    container.append(iframe);
  }

  // Ordenador: el registro ya está a la vista; el cupón lo señala
  function highlightDesk() {
    const r = deskPhone.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) deskPhone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    deskPhone.classList.remove('is-pulse');
    void deskPhone.offsetWidth; // reinicia la animación
    deskPhone.classList.add('is-pulse');
  }

  function open({ push = true } = {}) {
    if (desktop.matches) return highlightDesk();
    if (isOpen) return;
    isOpen = true;
    clearTimeout(unlockTimer);
    lastFocus = document.activeElement;
    ensureIframe();
    track('cupon');

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
  const warmUp = () => ensureIframe();
  promo.addEventListener('pointerenter', warmUp, { once: true });
  promo.addEventListener('touchstart', warmUp, { once: true, passive: true });
  promo.addEventListener('focus', warmUp, { once: true });

  // Ancho de la barra de scroll del sistema (0 en Mac/móvil), para el marco de ordenador
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-200px;width:100px;height:100px;overflow:scroll';
  document.body.append(probe);
  root.style.setProperty('--sb', `${probe.offsetWidth - probe.clientWidth}px`);
  probe.remove();

  // En ordenador el formulario se carga nada más entrar
  if (desktop.matches) ensureIframe(deskBody);
  desktop.addEventListener('change', (e) => {
    if (e.matches) {
      close();
      ensureIframe(deskBody);
    }
  });

  // Estadísticas: alguien empieza a usar el formulario de escritorio
  let deskTracked = false;
  addEventListener('blur', () => {
    if (!deskTracked && desktop.matches && document.activeElement === iframe) {
      deskTracked = true;
      track('cupon', { vista: 'escritorio' });
    }
  });

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
  const setLink = (country) => {
    tile.href = SaltyChats.linkFor(country);
    tile.dataset.grupo = tile.href === SaltyChats.linkFor('ES') ? 'hispano' : 'resto';
  };
  setLink(null); // provisional: por zona horaria
  SaltyChats.getCountry(4000).then((country) => {
    if (country) setLink(country);
  });
}

// Clics en enlaces y redes: cualquier elemento con data-track="nombre"
function initTracking() {
  // Se escucha después de la sugerencia de TikTok: si esta frena el clic
  // (defaultPrevented), no se cuenta hasta que el usuario continúe.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-track]');
    if (el && !e.defaultPrevented) track(el.dataset.track, el.dataset.grupo ? { grupo: el.dataset.grupo } : undefined);
  });

  // Visitas que llegan desde el navegador de TikTok
  if (root.classList.contains('in-tiktok')) track('visita-tiktok');
}

/* ──────────────────────────────────────────────────────────────────────────
   TikTok: sugerencia de abrir en el navegador
   ────────────────────────────────────────────────────────────────────────── */

// Dentro de TikTok, los botones con data-suggest (Telegram, guía, spreadsheet,
// zapatillas) muestran siempre una ventana que recomienda abrir la web en el
// navegador. "Continuar en TikTok" abre el enlace igualmente.
//
// Mientras la ventana está abierta, la dirección guarda qué botón se pulsó
// (?abrir=guia). Si el usuario usa "Abrir en el navegador", el navegador
// recibe esa dirección e initResume() le ofrece abrirlo con un toque.
const INTENT_PARAM = 'abrir';

function setIntent(name) {
  const url = new URL(location.href);
  if (name) url.searchParams.set(INTENT_PARAM, name);
  else url.searchParams.delete(INTENT_PARAM);
  history.replaceState(history.state, '', url);
}

function initSuggest() {
  const modal = document.getElementById('suggest');
  const continueBtn = document.getElementById('suggest-continue');
  if (!modal || !root.classList.contains('in-tiktok')) return;

  let pending = null;
  let bypass = false;
  let lastFocus = null;

  function open(link) {
    pending = link;
    lastFocus = document.activeElement;
    setIntent(link.dataset.track);
    root.classList.add('is-locked');
    modal.classList.add('is-open');
    modal.removeAttribute('aria-hidden');
    setTimeout(() => continueBtn.focus({ preventScroll: true }), 300);
    track('aviso-tiktok', { enlace: link.dataset.track });
  }

  function close() {
    setIntent(null);
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    root.classList.remove('is-locked');
    lastFocus?.focus?.({ preventScroll: true });
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-suggest]');
    if (!link || bypass) return;
    e.preventDefault();
    open(link);
  });

  continueBtn.addEventListener('click', () => {
    const link = pending;
    close();
    if (!link) return;
    track('continuar-tiktok', { enlace: link.dataset.track });
    // Clic "real" en el enlace: respeta si abre en esta pestaña o en otra
    bypass = true;
    link.click();
    bypass = false;
  });

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-suggest-close]')) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
  });
}

// Llegada al navegador desde TikTok con ?abrir=...: los móviles no dejan que
// una web abra otra pestaña o app sin un toque del usuario, así que se
// ofrece al instante un botón que lo abre con un solo toque, y la web se
// queda abierta detrás.
function initResume() {
  const panel = document.getElementById('resume');
  const intent = new URL(location.href).searchParams.get(INTENT_PARAM);
  if (!panel || !intent || root.classList.contains('in-tiktok')) return;

  setIntent(null); // al recargar no vuelve a salir
  const link = [...document.querySelectorAll('a[data-suggest]')].find((a) => a.dataset.track === intent);
  if (!link) return;

  const LABELS = { telegram: 'Telegram', guia: 'la guía', spreadsheet: 'el Spreadsheet', zapatillas: 'Zapatillas' };
  document.getElementById('resume-label').textContent = LABELS[intent] || intent;

  const hide = () => {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
  };

  document.getElementById('resume-open').addEventListener('click', () => {
    hide();
    link.click(); // dentro del toque: el móvil permite abrir la pestaña o la app
  });
  panel.querySelector('[data-resume-close]').addEventListener('click', hide);

  // Aparece justo después de la entrada de la página
  setTimeout(() => {
    panel.classList.add('is-open');
    panel.removeAttribute('aria-hidden');
    track('desde-tiktok', { enlace: intent });
  }, 350);
}

initSuggest(); // antes que initTracking: su clic se procesa primero
initTracking();
initFollowers();
initSheet();
initChats();
initResume();
