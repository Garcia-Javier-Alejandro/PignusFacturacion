import { errorResponse, json, requireAdmin } from '../../_lib/http.js';
import { enrichOrders, fetchBillingTaxes, fetchRecentPaidOrders } from '../../_lib/meliOrders.js';
import { OUTPUT_HEADERS, transformOrdersToRows } from '../../_lib/transform.js';

export async function onRequestGet({ request, env }) {
  const authError = await requireAdmin(request, env);

  if (authError) {
    return authError;
  }

  try {
    const recent = await fetchRecentPaidOrders(env, 20);
    recent.sort((a, b) => (b.date_created > a.date_created ? 1 : -1));

    const orders = await enrichOrders(recent, env);

    // Fetch IIBB/SIRTAC for all orders in one billing API call, then inject per order.
    const { taxes: billingTaxes, _debug: billingDebug } = await fetchBillingTaxes(orders, env);
    for (const order of orders) {
      const tax = billingTaxes.get(String(order.id));
      if (tax) { order._iibb = tax.iibb; order._sirtac = tax.sirtac; }
    }

    const rows = transformOrdersToRows(orders);
    return json({ headers: OUTPUT_HEADERS, rows, _billing: billingDebug });
  } catch (error) {
    return errorResponse(500, error.message);
  }
}
