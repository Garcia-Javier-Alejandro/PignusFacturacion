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
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  });
}

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
    if (!response.ok) throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
    const results = data.results || [];
    orders.push(...results);
    scrollId = data.scroll_id;
    if (!results.length) break;
  } while (scrollId);
  return orders;
}

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
    if (!response.ok) throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
    const results = data.results || [];
    orders.push(...results);
    total = data.paging?.total ?? orders.length;
    offset += results.length;
    if (!results.length) break;
  } while (offset < total);
  return orders;
}

export async function fetchAllPaidOrders(env) {
  const tokens = await getValidAccessToken(env);
  const sellerId = tokens.seller_id || env.MELI_SELLER_ID;
  let orders;
  try {
    orders = await fetchWithScroll(sellerId, tokens.access_token);
  } catch {
    const refreshed = await refreshAccessToken(env);
    orders = await fetchWithOffset(sellerId, refreshed.access_token);
  }
  return orders.filter(isPaidOrder);
}

async function probeTotal(sellerId, accessToken) {
  const probe = await requestOrders({ seller: sellerId, limit: '1', offset: '0' }, accessToken);
  const probeData = await probe.json();
  if (!probe.ok) throw new Error(probeData.message || probeData.error || 'Mercado Libre orders request failed');
  return probeData.paging?.total ?? 0;
}

export async function fetchLatestOrders(env, count = 20) {
  const tokens = await getValidAccessToken(env);
  const sellerId = tokens.seller_id || env.MELI_SELLER_ID;
  const total = await probeTotal(sellerId, tokens.access_token);
  const offset = Math.max(0, total - count);
  const response = await requestOrders(
    { seller: sellerId, limit: String(count), offset: String(offset) },
    tokens.access_token,
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
  return { orders: (data.results || []).filter(isPaidOrder), total, fetchedOffset: offset };
}

export async function fetchOrdersAtOffset(env, offset, count = 20) {
  const tokens = await getValidAccessToken(env);
  const sellerId = tokens.seller_id || env.MELI_SELLER_ID;
  const total = await probeTotal(sellerId, tokens.access_token);
  // null means first import with no prior fetch — start from the most recent page
  const targetOffset = offset === null
    ? Math.max(0, total - count)
    : Math.max(0, total > 0 ? Math.min(offset, total - 1) : offset);
  const response = await requestOrders(
    { seller: sellerId, limit: String(count), offset: String(targetOffset) },
    tokens.access_token,
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
  const realTotal = data.paging?.total ?? total;
  return { orders: (data.results || []).filter(isPaidOrder), total: realTotal, fetchedOffset: targetOffset };
}

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
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${tokens.access_token}`,
          'x-format-new': 'true',
        },
      });
      if (shipRes.ok) {
        const shipData = await shipRes.json();
        const city = shipData.receiver_address?.city
          ?? shipData.destination?.receiver_address?.city
          ?? shipData.destination?.shipping_address?.city
          ?? null;
        fullOrder.shipping = {
          ...fullOrder.shipping,
          receiver_address: {
            ...(shipData.receiver_address || {}),
            city,
          },
          _state: shipData.destination?.shipping_address?.state
               ?? shipData.destination?.receiver_address?.state
               ?? null,
        };
      }
    }
    enriched.push(fullOrder);
  }
  return [...enriched, ...orders.slice(ENRICH_LIMIT)];
}

export async function fetchFiscalDate(packId, orderId, accessToken) {
  const paths = [`packs/${packId || orderId}/fiscal_documents`];

  for (const path of paths) {
    const res = await fetch(`https://api.mercadolibre.com/${path}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok || res.status === 204) continue;
    let data;
    try { data = await res.json(); } catch { continue; }
    if (!data || typeof data !== 'object') continue;
    const items = Array.isArray(data) ? data : (data.fiscal_documents ?? data.results ?? [data]);
    if (!Array.isArray(items)) continue;
    for (const doc of items) {
      if (!doc || typeof doc !== 'object') continue;
      const date = doc.date ?? doc.fiscal_date ?? doc.date_created ?? doc.issue_date ?? null;
      if (date) return date;
    }
  }
  return null;
}

export async function fetchCouponAmount(orderId, accessToken) {
  const res = await fetch(`https://api.mercadolibre.com/orders/${orderId}/discounts`, {
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return 0;
  const data = await res.json();
  let total = 0;
  for (const detail of data.details || []) {
    if (detail.type === 'coupon') {
      for (const item of detail.items || []) {
        total += Number(item.amounts?.total || 0);
      }
    }
  }
  return total;
}

const BILLING_BATCH = 10;

function computeTaxesFromItem(item) {
  let iibb = 0;
  let sirtac = 0;
  for (const payment of item.payment_info || []) {
    for (const tax of payment.tax_details || []) {
      const detail = (tax.mov_detail || '').toLowerCase();
      const entity = (tax.mov_financial_entity || '').toLowerCase();
      const amount = Number(tax.original_amount || 0);
      if (detail.includes('sirtac')) sirtac += amount;
      else if (detail.startsWith('tax_withholding') || detail.includes('iibb') || entity.includes('iibb')) iibb += amount;
    }
  }
  return { iibb, sirtac };
}

async function fetchBillingDetails(orderIds, accessToken) {
  const res = await fetch(
    `https://api.mercadolibre.com/billing/integration/group/ML/order/details?order_ids=${orderIds.join(',')}`,
    { headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  return res.json();
}

export async function fetchBillingTaxes(orders, env) {
  const tokens = await getValidAccessToken(env);
  const taxes = new Map();
  const requestedIds = orders.map((o) => String(o.id));

  for (let i = 0; i < requestedIds.length; i += BILLING_BATCH) {
    const batchIds = requestedIds.slice(i, i + BILLING_BATCH);
    const data = await fetchBillingDetails(batchIds, tokens.access_token);
    if (!data) continue;
    for (const item of data.results || []) {
      taxes.set(String(item.order_id), computeTaxesFromItem(item));
    }
  }

  // Fallback: ML's batch endpoint omits orders whose billing document is still
  // PROCESSING, even when tax data is computable. Individual queries return
  // them, so retry one-by-one for any order missing from the batch responses.
  const missing = requestedIds.filter((id) => !taxes.has(id));
  for (const id of missing) {
    const data = await fetchBillingDetails([id], tokens.access_token);
    if (!data) continue;
    for (const item of data.results || []) {
      taxes.set(String(item.order_id), computeTaxesFromItem(item));
    }
  }

  return taxes;
}
