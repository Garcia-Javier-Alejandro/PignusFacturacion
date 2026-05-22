import { errorResponse, json } from '../../_lib/http.js';
import { getOrdersCache } from '../../_lib/ordersCache.js';
import { clearSheet, overwriteRows } from '../../_lib/sheets.js';
import { OUTPUT_HEADERS, transformOrdersToRows } from '../../_lib/transform.js';

export async function onRequestPost({ env }) {
  try {
    const [cache, edits] = await Promise.all([
      getOrdersCache(env),
      env.PIGNUS_TOKENS.get('edits', 'json').then((e) => e || { invoiceRows: [] }),
    ]);

    await clearSheet(env);

    const sortedOrders = [...(cache.orders || [])].sort(
      (a, b) => (a.date_created > b.date_created ? 1 : -1),
    );
    const allRows = [
      ...transformOrdersToRows(sortedOrders),
      ...(edits.invoiceRows || []),
    ];
    allRows.sort((a, b) => (a[1] > b[1] ? 1 : -1));

    const toWrite = [OUTPUT_HEADERS, ...allRows];
    const result = await overwriteRows(env, toWrite);

    return json({
      exported_rows: allRows.length,
      sheet_name: env.SHEET_NAME || 'Ventas',
      google_updated_rows: result.updatedRows || toWrite.length,
    });
  } catch (error) {
    return errorResponse(500, error.message);
  }
}
