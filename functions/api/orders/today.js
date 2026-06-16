import { errorResponse, json } from '../../_lib/http.js';
import { getValidAccessToken } from '../../_lib/meliAuth.js';
import { fetchEnrichAndStore } from '../../_lib/fetchAndStore.js';
import { getOrdersCache } from '../../_lib/ordersCache.js';
import { requireSyncAuth } from '../../_lib/cronAuth.js';

const ART_OFFSET_MS = 3 * 60 * 60 * 1000; // Argentina is always UTC-3 (no DST)

// 14d covers Sunday drops, delayed payments, and short sync gaps.
// fetchEnrichAndStore hits the strict-rate-limited billing endpoint per order
// passed in, so we always pre-dedupe against cache.seen_ids — only orders
// genuinely new to the cache go through enrichment.
const WINDOW_DAYS  = 14;
const PAGE_SIZE    = 50;
const MAX_PAGES    = 10; // hard cap → ≤500 orders scanned per click

function artDateStr(utcMs) {
  const d = new Date(utcMs - ART_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const isPaid = (o) =>
  o.status === 'paid' || (o.payments || []).some((p) => p.status === 'approved');

export async function onRequestGet({ env, request }) {
  const authError = requireSyncAuth(request, env);
  if (authError) return authError;
  try {
    const now = Date.now();
    const todayART       = artDateStr(now);
    const yesterdayART   = artDateStr(now - 24 * 60 * 60 * 1000);
    const windowStartART = artDateStr(now - (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);

    const tokens = await getValidAccessToken(env);
    const { access_token } = tokens;
    const sellerId = tokens.seller_id || env.MELI_SELLER_ID;

    const inWindow = [];
    let total = 0;
    let walkedPast = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const u = new URL('https://api.mercadolibre.com/orders/search');
      u.searchParams.set('seller', sellerId);
      u.searchParams.set('sort', 'date_desc');
      u.searchParams.set('limit', String(PAGE_SIZE));
      u.searchParams.set('offset', String(page * PAGE_SIZE));
      const res = await fetch(u, {
        headers: { accept: 'application/json', authorization: `Bearer ${access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'ML orders request failed');
      total = data.paging?.total ?? total;
      const results = data.results || [];
      if (!results.length) break;

      for (const o of results) {
        const d = artDateStr(new Date(o.date_created).getTime());
        if (d < windowStartART) { walkedPast = true; break; }
        if (!isPaid(o)) continue;
        inWindow.push(o);
      }
      if (walkedPast) break;
    }

    // Pre-dedupe so the billing endpoint (hourly-quota-capped) only runs for new orders
    const cache = await getOrdersCache(env);
    const seenSet = new Set(cache.seen_ids || []);
    const newOrders = inWindow.filter((o) => !seenSet.has(String(o.id)));

    let fetched_today = 0;
    let fetched_yesterday = 0;
    let fetched_backfill = 0;
    for (const o of newOrders) {
      const d = artDateStr(new Date(o.date_created).getTime());
      if (d === todayART) fetched_today++;
      else if (d === yesterdayART) fetched_yesterday++;
      else fetched_backfill++;
    }

    // fetchedOffset = total seeds next_older_offset = total - 20 on a fresh cache.
    const result = await fetchEnrichAndStore(env, {
      orders: newOrders,
      total,
      fetchedOffset: total,
      isOlderFetch: false,
    });

    return json({
      ...result,
      fetched_today,
      fetched_yesterday,
      fetched_backfill,
      window_days: WINDOW_DAYS,
      window_start: windowStartART,
    });
  } catch (error) {
    return errorResponse(500, error.message);
  }
}
