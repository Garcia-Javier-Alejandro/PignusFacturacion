import { enrichOrders, fetchBillingTaxes } from './meliOrders.js';
import { OUTPUT_HEADERS, transformOrdersToRows } from './transform.js';
import { getOrdersCache, saveOrdersCache, mergeIntoCache, isCacheDone } from './ordersCache.js';

export async function fetchEnrichAndStore(env, { orders, total, fetchedOffset, isOlderFetch }) {
  const enriched = await enrichOrders(orders, env);
  const billingTaxes = await fetchBillingTaxes(enriched, env);
  for (const order of enriched) {
    const tax = billingTaxes.get(String(order.id));
    if (tax) { order._iibb = tax.iibb; order._sirtac = tax.sirtac; }
  }

  const cache = await getOrdersCache(env);
  const updated = mergeIntoCache(cache, { newOrders: enriched, total, fetchedOffset, isOlderFetch });
  await saveOrdersCache(env, updated);

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
    },
  };
}
