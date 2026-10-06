/* ==========================================================================
   API de seguidores · Cloudflare Worker (gratis: 100.000 peticiones/día)

   Devuelve: { "total": 10942, "tiktok": 5732, "instagram": 5210, "updatedAt": "…" }

   Este mismo archivo lo usa la GitHub Action (scripts/update-followers.mjs)
   para generar data/followers.json como respaldo.
   ========================================================================== */

export const ACCOUNTS = {
  tiktok: 'salty.cn',
  instagram: 'saltychina',
};

const CACHE_MS = 60_000; // como mucho, una consulta real por minuto

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

/* ── TikTok: el perfil público incluye las estadísticas en el HTML ───── */

export async function getTikTok(user = ACCOUNTS.tiktok) {
  const res = await fetch(`https://www.tiktok.com/@${user}`, {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`TikTok HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/"stats":\{"followerCount":(\d+)/) || html.match(/"followerCount":"?(\d+)/);
  if (!m) throw new Error('TikTok: followerCount no encontrado');
  return Number(m[1]);
}

/* ── Instagram: API pública (cifra exacta) o, si falla, la vista previa ─ */

function parseCompact(text) {
  // "5,210" · "12.5K" · "1.2M"
  const m = text.match(/^([\d.,]+)\s*([KkMm]?)$/);
  if (!m) return NaN;
  const mult = { k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1;
  const num = mult === 1 ? Number(m[1].replace(/[.,]/g, '')) : Number(m[1].replace(/,/g, ''));
  return Math.round(num * mult);
}

export async function getInstagram(user = ACCOUNTS.instagram) {
  try {
    const res = await fetch(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${user}`,
      { headers: { 'User-Agent': BROWSER_UA, 'x-ig-app-id': '936619743392459' } },
    );
    if (res.ok) {
      const json = await res.json();
      const n = json?.data?.user?.edge_followed_by?.count;
      if (Number.isFinite(n)) return n;
    }
  } catch {
    /* pasamos al plan B */
  }

  const res = await fetch(`https://www.instagram.com/${user}/`, {
    headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`Instagram HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/content="([\d.,]+\s*[KkMm]?)\s+Followers/);
  const n = m ? parseCompact(m[1]) : NaN;
  if (!Number.isFinite(n)) throw new Error('Instagram: seguidores no encontrados');
  return n;
}

/* ── Suma, conservando el último dato bueno si una red falla ────────── */

export async function getFollowers(previous = {}) {
  const [tt, ig] = await Promise.allSettled([getTikTok(), getInstagram()]);
  const tiktok = tt.status === 'fulfilled' ? tt.value : previous.tiktok;
  const instagram = ig.status === 'fulfilled' ? ig.value : previous.instagram;
  if (!Number.isFinite(tiktok) && !Number.isFinite(instagram)) {
    throw new Error(`Sin datos: ${tt.reason?.message} / ${ig.reason?.message}`);
  }
  return {
    total: (tiktok || 0) + (instagram || 0),
    tiktok: tiktok ?? null,
    instagram: instagram ?? null,
    updatedAt: new Date().toISOString(),
    errors: [tt, ig].filter((r) => r.status === 'rejected').map((r) => r.reason.message),
  };
}

/* ── Worker ──────────────────────────────────────────────────────────── */

let memo = null; // { data, at } — vive mientras la instancia del Worker siga activa
let inflight = null;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=30',
    },
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (memo && Date.now() - memo.at < CACHE_MS) return json(memo.data);

    try {
      inflight ??= getFollowers(memo?.data).finally(() => { inflight = null; });
      const data = await inflight;
      memo = { data, at: Date.now() };
      return json(data);
    } catch (err) {
      if (memo) return json(memo.data); // mejor un dato de hace un rato que nada
      return json({ error: String(err.message || err) }, 502);
    }
  },
};
