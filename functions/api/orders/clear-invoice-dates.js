import { json, errorResponse } from '../../_lib/http.js';
import { getOrdersCache, saveOrdersCache } from '../../_lib/ordersCache.js';

const EDITS_KEY = 'edits';

export async function onRequestPost({ env }) {
  try {
    const [cache, edits] = await Promise.all([
      getOrdersCache(env),
      env.PIGNUS_TOKENS.get(EDITS_KEY, 'json').then(
        (e) => e || { manualRows: [], hiddenIds: [], mlOverrides: {}, invoiceRows: [] },
      ),
    ]);

    let cleared = 0;
    for (const order of cache.orders) {
      if (order._fecha_factura || order._numero_factura) {
        order._fecha_factura = null;
        order._numero_factura = null;
        order._invoice_source = null;
        cleared++;
      }
    }

    const invoiceRowsCleared = (edits.invoiceRows || []).length;
    edits.invoiceRows = [];

    await Promise.all([
      saveOrdersCache(env, cache),
      env.PIGNUS_TOKENS.put(EDITS_KEY, JSON.stringify(edits)),
    ]);

    return json({ ok: true, cleared, invoice_rows_cleared: invoiceRowsCleared });
  } catch (err) {
    return errorResponse(500, err.message);
  }
}
