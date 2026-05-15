import { errorResponse, json } from '../../_lib/http.js';
import { getOrdersCache } from '../../_lib/ordersCache.js';
import { appendRows, getExistingOrderIds } from '../../_lib/sheets.js';
import { OUTPUT_HEADERS, transformOrdersToRows } from '../../_lib/transform.js';

export async function onRequestPost({ env }) {
  try {
    const [existingOrderIds, cache, edits] = await Promise.all([
      getExistingOrderIds(env),
      getOrdersCache(env),
      env.PIGNUS_TOKENS.get('edits', 'json').then((e) => e || { invoiceRows: [] }),
    ]);

    const sortedOrders = [...(cache.orders || [])].sort(
      (a, b) => (a.date_created > b.date_created ? 1 : -1),
    );
    const allRows = [
      ...transformOrdersToRows(sortedOrders),
      ...(edits.invoiceRows || []),
    ];
    // Stable ascending sort by date string; within the same day, cache rows keep
    // their date_created time order from the pre-sort above.
    allRows.sort((a, b) => (a[1] > b[1] ? 1 : -1));

    const newRows = allRows.filter((row) => !existingOrderIds.has(String(row[0])));
    const toAppend = existingOrderIds.size === 0
      ? [OUTPUT_HEADERS, ...newRows]
      : newRows;

    const result = await appendRows(env, toAppend);

    return json({
      exported_rows: newRows.length,
      skipped_existing: allRows.length - newRows.length,
      included_header: existingOrderIds.size === 0 && newRows.length > 0,
      sheet_name: env.SHEET_NAME || 'Ventas',
      google_updated_rows: result.updates?.updatedRows || toAppend.length,
    });
  } catch (error) {
    return errorResponse(500, error.message);
  }
}
