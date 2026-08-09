import { json, errorResponse } from '../../_lib/http.js';
import { getValidAccessToken } from '../../_lib/meliAuth.js';
import { getOrdersCache, saveOrdersCache } from '../../_lib/ordersCache.js';
import { requireSyncAuth } from '../../_lib/cronAuth.js';

// Cached orders are frozen at first fetch (seen_ids blocks re-processing), so an order
// that was paid when ingested and later cancelled by the customer stays in the cache and
// keeps counting as "pending to bill" forever. This one-off reconciliation asks ML for the
// seller's cancelled orders and purges any that are sitting non-invoiced in the cache.
//
// Guarded by requireSyncAuth: the custom domain is trusted (Cloudflare Access), the public
// *.pages.dev host requires the cron secret — so this mutating endpoint isn't openly callable.

const PAGE_SIZE = 50;
const MAX_PAGES = 30; // ≤1500 cancelled orders scanned — safe upper bound for the account

const isInvoiced = (o) => !!(o._numero_factura || o._fecha_factura);

export async function onRequestPost({ env, request }) {
  const authError = requireSyncAuth(request, env);
  if (authError) return authError;
  try {
    const cache = await getOrdersCache(env);
    const orders = cache.orders || [];
    if (!orders.length) return json({ ok: true, checked: 0, removed: 0, removed_ids: [] });

    const tokens = await getValidAccessToken(env);
    const sellerId = tokens.seller_id || env.MELI_SELLER_ID;

    // Only orders old enough to be past the daily-sync self-heal window can be stuck here,
    // but we scan back to the cache's oldest date to be exhaustive.
    const oldestMs = cache.oldest_date ? new Date(cache.oldest_date).getTime() : 0;

    const cancelledKeys = new Set();
    for (let page = 0; page < MAX_PAGES; page++) {
      const u = new URL('https://api.mercadolibre.com/orders/search');
      u.searchParams.set('seller', sellerId);
      u.searchParams.set('order.status', 'cancelled');
      u.searchParams.set('sort', 'date_desc');
      u.searchParams.set('limit', String(PAGE_SIZE));
      u.searchParams.set('offset', String(page * PAGE_SIZE));
      const res = await fetch(u, {
        headers: { accept: 'application/json', authorization: `Bearer ${tokens.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'ML cancelled-orders request failed');
      const results = data.results || [];
      if (!results.length) break;

      let walkedPast = false;
      for (const o of results) {
        cancelledKeys.add(String(o.id));
        if (o.pack_id != null) cancelledKeys.add(String(o.pack_id));
        if (new Date(o.date_created).getTime() < oldestMs) walkedPast = true;
      }
      if (walkedPast) break;
      const total = data.paging?.total ?? results.length;
      if ((page + 1) * PAGE_SIZE >= total) break;
    }

    const removed = [];
    const kept = [];
    for (const o of orders) {
      const hit = cancelledKeys.has(String(o.id))
        || (o.pack_id != null && cancelledKeys.has(String(o.pack_id)));
      // Leave invoiced orders alone — a cancelled-after-invoicing order is a separate,
      // rarer accounting case we don't want to silently drop here.
      if (hit && !isInvoiced(o)) {
        removed.push({ id: String(o.id), date: o.date_created });
      } else {
        kept.push(o);
      }
    }

    if (removed.length) {
      // seen_ids already contains these ids, so they act as tombstones and won't re-enter
      // (isPaidOrder / isPaid now also reject cancelled). Recompute the date bounds since we
      // may have dropped the oldest order.
      cache.orders = kept;
      cache.newest_date = kept.length ? kept[0].date_created : null;
      cache.oldest_date = kept.length ? kept[kept.length - 1].date_created : null;
      cache.updated_at = new Date().toISOString();
      await saveOrdersCache(env, cache);
    }

    return json({
      ok: true,
      checked: orders.length,
      cancelled_found: cancelledKeys.size,
      removed: removed.length,
      removed_ids: removed.map((r) => r.id),
    });
  } catch (err) {
    return errorResponse(500, err.message);
  }
}
