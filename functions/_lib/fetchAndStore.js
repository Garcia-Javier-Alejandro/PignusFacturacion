import { enrichOrders, fetchBillingTaxes } from './meliOrders.js';
import { OUTPUT_HEADERS, transformOrdersToRows } from './transform.js';
import { getOrdersCache, saveOrdersCache, mergeIntoCache, isCacheDone } from './ordersCache.js';
import { dualWriteToD1 } from './d1Sync.js';

export async function fetchEnrichAndStore(env, { orders, staleOrders = [], total, fetchedOffset, isOlderFetch, cancelledIds = [] }) {
  const enriched = await enrichOrders(orders, env);
  const billingTaxes = await fetchBillingTaxes([...enriched, ...staleOrders], env);
  for (const order of [...enriched, ...staleOrders]) {
    const tax = billingTaxes.get(String(order.id));
    if (tax) { order._iibb = tax.iibb; order._sirtac = tax.sirtac; }
  }

  const cache = await getOrdersCache(env);
  const updated = mergeIntoCache(cache, { newOrders: [...enriched, ...staleOrders], total, fetchedOffset, isOlderFetch, cancelledIds });
  await saveOrdersCache(env, updated);

  // Dual-write the touched orders to D1 (source='meli_live'), best-effort: a D1
  // failure must never break the KV sync (the user-facing source of truth).
  // Expand touched ids to their COMPLETE packs from the merged cache so pack rows
  // are never written partially (a stale single-item refresh could otherwise clobber).
  let d1 = null;
  try {
    const touchedIds = new Set([...enriched, ...staleOrders].map((o) => String(o.id)));
    const touchedPacks = new Set(
      updated.orders.filter((o) => touchedIds.has(String(o.id))).map((o) => String(o.pack_id || o.id)),
    );
    const toWrite = updated.orders.filter((o) => touchedPacks.has(String(o.pack_id || o.id)));
    d1 = await dualWriteToD1(env, { orders: toWrite, cancelledIds });
  } catch (error) {
    console.error('D1 dual-write failed:', error);
    d1 = { error: String(error?.message || error) };
  }

  const rows = transformOrdersToRows(updated.orders);
  rows.sort((a, b) => (b[1] > a[1] ? 1 : -1));

  return {
    headers: OUTPUT_HEADERS,
    rows,
    meta: {
      loaded: updated.orders.length,
      total: updated.probe_total,
      oldest_date: updated.oldest_date,
      newest_date: updated.newest_date,
      next_older_offset: updated.next_older_offset,
      done: isCacheDone(updated),
      d1,
    },
  };
}
