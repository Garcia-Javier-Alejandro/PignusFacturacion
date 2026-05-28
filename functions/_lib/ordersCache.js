const _t = new Date();
export const HISTORY_CUTOFF = new Date(_t.getFullYear(), _t.getMonth() - 11, 1).toISOString().slice(0, 19);
const CACHE_KEY = 'orders_cache';

export async function getOrdersCache(env) {
  const cache = await env.PIGNUS_TOKENS.get(CACHE_KEY, 'json') || {
    orders: [],
    seen_ids: [],
    probe_total: 0,
    next_older_offset: null,
    oldest_date: null,
    newest_date: null,
    updated_at: null,
  };
  if (!cache.newest_date && cache.orders && cache.orders.length > 0) {
    cache.newest_date = cache.orders[0].date_created;
  }
  return cache;
}

export async function saveOrdersCache(env, cache) {
  await env.PIGNUS_TOKENS.put(CACHE_KEY, JSON.stringify(cache));
}

function slimOrder(order) {
  return {
    id: order.id,
    pack_id: order.pack_id,
    date_created: order.date_created,
    payments: (order.payments || []).map((p) => ({
      transaction_amount: p.transaction_amount,
      total_paid_amount: p.total_paid_amount,
      shipping_cost: p.shipping_cost,
      status: p.status,
    })),
    order_items: (order.order_items || []).map((i) => ({
      quantity: i.quantity,
      unit_price: i.unit_price,
      full_unit_price: i.full_unit_price,
      sale_fee: i.sale_fee,
      seller_sku: i.item?.seller_sku ?? null,
      title: i.item?.title ?? null,
    })),
    buyer: order.buyer ? {
      first_name: order.buyer.first_name,
      last_name: order.buyer.last_name,
      nickname: order.buyer.nickname,
    } : undefined,
    shipping: order.shipping ? {
      cost: order.shipping.cost,
      receiver_address: order.shipping.receiver_address ? {
        city: order.shipping.receiver_address.city,
      } : undefined,
      _state: order.shipping._state,
    } : undefined,
    _iibb: order._iibb,
    _sirtac: order._sirtac,
    _fecha_factura: order._fecha_factura,
    _numero_factura: order._numero_factura ?? null,
    _invoice_source: order._invoice_source ?? null,
    _cupon: order._cupon,
  };
}

// isOlderFetch=false on "fetch latest" — preserves existing next_older_offset after first load.
// next_older_offset only goes negative via an explicit import (isOlderFetch=true) so a cron
// fetch on a fresh cache can never accidentally set the "done" signal.
export function mergeIntoCache(cache, { newOrders, total, fetchedOffset, isOlderFetch }) {
  const seenSet = new Set(cache.seen_ids || []);
  const existingById = new Map((cache.orders || []).map((o) => [String(o.id), o]));

  const added = [];
  for (const order of newOrders) {
    const id = String(order.id);
    const slim = slimOrder(order);
    if (seenSet.has(id)) {
      const existing = existingById.get(id);
      if (existing) {
        // Backfill tax fields that were missing/zero — fixes orders cached before ML
        // billing detail was populated (mergeIntoCache was previously add-only).
        if ((existing._iibb == null || existing._iibb === 0) && slim._iibb) existing._iibb = slim._iibb;
        if ((existing._sirtac == null || existing._sirtac === 0) && slim._sirtac) existing._sirtac = slim._sirtac;
      }
      continue;
    }
    seenSet.add(id);
    added.push(slim);
  }

  const allOrders = [...(cache.orders || []), ...added];
  allOrders.sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime());

  const newestDate = allOrders.length > 0 ? allOrders[0].date_created : null;
  const oldestDate = allOrders.length > 0 ? allOrders[allOrders.length - 1].date_created : null;

  const nextOlderOffset = isOlderFetch
    ? fetchedOffset - 20
    : (cache.next_older_offset !== null ? cache.next_older_offset : Math.max(0, fetchedOffset - 20));

  return {
    orders: allOrders,
    seen_ids: [...seenSet],
    probe_total: total ?? cache.probe_total,
    next_older_offset: nextOlderOffset,
    oldest_date: oldestDate,
    newest_date: newestDate,
    updated_at: new Date().toISOString(),
  };
}

export function isCacheDone(cache) {
  // ≤ -20 means we've completed a fetch starting at offset 0 (0 - 20 = -20).
  // Using < 0 fired too early when total orders < 40 (initial fetch offset < 20).
  if (cache.next_older_offset !== null && cache.next_older_offset <= -20) return true;
  if (cache.oldest_date && cache.oldest_date < HISTORY_CUTOFF) return true;
  return false;
}
