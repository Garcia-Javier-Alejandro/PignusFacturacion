import { appendRows, getExistingOrderIds } from './clients/sheetsClient.js';
import { fetchPaidOrders } from './services/ordersService.js';
import { buildHeaderRow, transformOrders } from './services/transformService.js';

async function main() {
  console.info('Fetching paid Mercado Libre orders...');
  const orders = await fetchPaidOrders();
  console.info(`Fetched ${orders.length} paid orders.`);

  const existingOrderIds = await getExistingOrderIds();
  const newOrders = orders.filter((order) => !existingOrderIds.has(String(order.id)));
  console.info(`Found ${newOrders.length} new paid orders.`);

  const transformedRows = transformOrders(newOrders);
  const rows = existingOrderIds.size === 0
    ? [buildHeaderRow(), ...transformedRows]
    : transformedRows;

  console.info(`Appending ${rows.length} rows to Google Sheets...`);
  await appendRows(rows);
  console.info('Done.');
}

main().catch((error) => {
  const details = error.response?.data || error.message;
  console.error('Script failed:', details);
  process.exitCode = 1;
});
