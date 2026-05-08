import { getValidAccessToken, refreshAccessToken } from './meliAuth.js';

const PAGE_SIZE = 50;

const isPaidOrder = (order) => (
  order.status === 'paid'
  || (order.payments || []).some((payment) => payment.status === 'approved')
);

async function requestOrders(params, accessToken) {
  const url = new URL('https://api.mercadolibre.com/orders/search');

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  });
}

// Fetch all orders using scroll (cursor) pagination. More efficient for large result sets.
async function fetchWithScroll(sellerId, accessToken) {
  const orders = [];
  let scrollId;

  do {
    const response = await requestOrders({
      seller: sellerId,
      search_type: 'scan',
      limit: String(PAGE_SIZE),
      ...(scrollId ? { scroll_id: scrollId } : {}),
    }, accessToken);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
    }

    const results = data.results || [];
    orders.push(...results);
    scrollId = data.scroll_id;

    if (!results.length) break;
  } while (scrollId);

  return orders;
}

// Fetch all orders using offset pagination. Accepts extra params (e.g. date filters).
async function fetchWithOffset(sellerId, accessToken, extraParams = {}) {
  const orders = [];
  let offset = 0;
  let total = null;

  do {
    const response = await requestOrders({
      seller: sellerId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      ...extraParams,
    }, accessToken);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
    }

    const results = data.results || [];
    orders.push(...results);
    total = data.paging?.total ?? orders.length;
    offset += results.length;

    if (!results.length) break;
  } while (offset < total);

  return orders;
}

// Fetch every paid order. Used by the scheduled cron and the manual export endpoint.
export async function fetchAllPaidOrders(env) {
  const tokens = await getValidAccessToken(env);
  const sellerId = tokens.seller_id || env.MELI_SELLER_ID;
  let orders;

  try {
    orders = await fetchWithScroll(sellerId, tokens.access_token);
  } catch {
    // Scroll pagination can be unavailable on some accounts; fall back to offset.
    const refreshed = await refreshAccessToken(env);
    orders = await fetchWithOffset(sellerId, refreshed.access_token);
  }

  return orders.filter(isPaidOrder);
}

// Fetch the most recent `count` paid orders.
// Uses 2 fetches (1 probe + 1 page), reserving budget for per-order enrichment.
export async function fetchRecentPaidOrders(env, count = 20) {
  const tokens = await getValidAccessToken(env);
  const sellerId = tokens.seller_id || env.MELI_SELLER_ID;

  const probe = await requestOrders({ seller: sellerId, limit: '1', offset: '0' }, tokens.access_token);
  const probeData = await probe.json();
  if (!probe.ok) throw new Error(probeData.message || probeData.error || 'Mercado Libre orders request failed');

  const total = probeData.paging?.total ?? 0;
  const offset = Math.max(0, total - count);

  const response = await requestOrders({
    seller: sellerId,
    limit: String(count),
    offset: String(offset),
  }, tokens.access_token);

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || 'Mercado Libre orders request failed');

  const results = data.results || [];
  const paid = results.filter(isPaidOrder);

  // Attach debug info so callers can surface it when count is 0.
  paid._debug = { seller_id: sellerId, probe_total: total, raw_count: results.length, paid_count: paid.length, statuses: results.map((o) => o.status), probe_raw: probeData };

  return paid;
}

// Enrich orders with full detail. For each order: one call to GET /orders/{id}
// (for buyer real name) and one call to GET /shipments/{id} (for city name).
// Capped at 20 orders so total fetches stay at 5 + 20 + 20 = 45, under the 50 limit.
const ENRICH_LIMIT = 20;

export async function enrichOrders(orders, env) {
  const tokens = await getValidAccessToken(env);
  const enriched = [];

  for (const order of orders.slice(0, ENRICH_LIMIT)) {
    const orderRes = await fetch(`https://api.mercadolibre.com/orders/${order.id}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${tokens.access_token}` },
    });
    const fullOrder = orderRes.ok ? await orderRes.json() : order;

    const shippingId = fullOrder.shipping?.id ?? order.shipping?.id;
    if (shippingId) {
      const shipRes = await fetch(`https://api.mercadolibre.com/shipments/${shippingId}`, {
        headers: { accept: 'application/json', authorization: `Bearer ${tokens.access_token}` },
      });
      if (shipRes.ok) {
        const shipData = await shipRes.json();
        fullOrder.shipping = { ...fullOrder.shipping, receiver_address: shipData.receiver_address };
      }
    }

    enriched.push(fullOrder);
  }

  return [...enriched, ...orders.slice(ENRICH_LIMIT)];
}

// Fetch IIBB and SIRTAC tax withholdings for a list of orders from the billing API.
// One call covers all order IDs; fails gracefully (returns empty Map) on 429 or error.
export async function fetchBillingTaxes(orders, env) {
  const tokens = await getValidAccessToken(env);
  const orderIds = orders.map((o) => o.id).join(',');

  const res = await fetch(
    `https://api.mercadolibre.com/billing/integration/group/ML/order/details?order_ids=${orderIds}`,
    { headers: { accept: 'application/json', authorization: `Bearer ${tokens.access_token}` } },
  );

  const data = await res.json();

  if (!res.ok) return { taxes: new Map(), _debug: { status: res.status, body: data } };

  const taxes = new Map();

  for (const item of data.results || []) {
    let iibb = 0;
    let sirtac = 0;

    for (const payment of item.payment_info || []) {
      for (const tax of payment.tax_details || []) {
        const detail = (tax.mov_detail || '').toLowerCase();
        const entity = (tax.mov_financial_entity || '').toLowerCase();
        if (detail.includes('sirtac')) sirtac += Number(tax.original_amount || 0);
        else if (detail.includes('iibb') || entity.includes('iibb')) iibb += Number(tax.original_amount || 0);
      }
    }

    taxes.set(String(item.order_id), { iibb, sirtac });
  }

  return { taxes, _debug: { status: res.status, first_result: data.results?.[0] ?? data } };
}
