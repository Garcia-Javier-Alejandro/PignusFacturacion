import { errorResponse, json } from '../../_lib/http.js';
import { getValidAccessToken } from '../../_lib/meliAuth.js';
import { fetchEnrichAndStore } from '../../_lib/fetchAndStore.js';

const ART_OFFSET_MS = 3 * 60 * 60 * 1000; // Argentina is always UTC-3 (no DST)

const isPaid = (o) =>
  o.status === 'paid' || (o.payments || []).some((p) => p.status === 'approved');

export async function onRequestGet({ env }) {
  try {
    // Today's bounds in Argentina local time
    const nowART = new Date(Date.now() - ART_OFFSET_MS);
    const y = nowART.getUTCFullYear();
    const m = String(nowART.getUTCMonth() + 1).padStart(2, '0');
    const d = String(nowART.getUTCDate()).padStart(2, '0');
    const from = `${y}-${m}-${d}T00:00:00.000-03:00`;
    const to   = `${y}-${m}-${d}T23:59:59.999-03:00`;

    const tokens = await getValidAccessToken(env);
    const { access_token } = tokens;
    const sellerId = tokens.seller_id || env.MELI_SELLER_ID;

    // Probe total — needed to seed next_older_offset correctly on a fresh cache
    const probeRes = await fetch(
      `https://api.mercadolibre.com/orders/search?seller=${encodeURIComponent(sellerId)}&limit=1&offset=0`,
      { headers: { accept: 'application/json', authorization: `Bearer ${access_token}` } },
    );
    const probeData = await probeRes.json();
    if (!probeRes.ok) throw new Error(probeData.message || probeData.error || 'ML probe failed');
    const total = probeData.paging?.total ?? 0;

    // Fetch orders closed today (ML max per page = 50)
    const url = new URL('https://api.mercadolibre.com/orders/search');
    url.searchParams.set('seller', sellerId);
    url.searchParams.set('date_created.from', from);
    url.searchParams.set('date_created.to', to);
    url.searchParams.set('sort', 'date_asc');
    url.searchParams.set('limit', '50');

    const res = await fetch(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${access_token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'ML orders request failed');

    const todayOrders = (data.results || []).filter(isPaid);
    const totalToday  = data.paging?.total ?? todayOrders.length;

    // Reuse the standard enrich + cache pipeline.
    // fetchedOffset = total so a fresh cache seeds next_older_offset = total - 20 (correct
    // starting point for the history import), while an existing cache keeps its offset unchanged.
    const result = await fetchEnrichAndStore(env, {
      orders: todayOrders,
      total,
      fetchedOffset: total,
      isOlderFetch: false,
    });

    return json({ ...result, fetched_today: todayOrders.length, total_today: totalToday });
  } catch (error) {
    return errorResponse(500, error.message);
  }
}
