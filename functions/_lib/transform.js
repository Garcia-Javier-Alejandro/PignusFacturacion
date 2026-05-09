const toNumber = (value) => Number(value || 0);

export const OUTPUT_HEADERS = [
  'Orden ID',
  'Fecha Compra',
  'Nombre',
  'Pago',
  'Recargo MP',
  'Retencion IIBB',
  'Imp SIRTAC',
  'Suma Impuestos',
  'Costo Envio',
  'Neto',
  'Localidad',
  'Provincia',
  'Orígen',
];

const sumPaymentsField = (payments, field) => (
  payments.reduce((total, payment) => total + toNumber(payment[field]), 0)
);

const calculateProductRevenue = (order, payments) => {
  const productsTotal = (order.order_items || []).reduce((total, item) => {
    const quantity = toNumber(item.quantity || 1);
    const unitPrice = toNumber(item.unit_price ?? item.full_unit_price);
    return total + quantity * unitPrice;
  }, 0);
  return productsTotal || sumPaymentsField(payments, 'transaction_amount') || sumPaymentsField(payments, 'total_paid_amount');
};

const calculateMercadoPagoFee = (order) => (
  (order.order_items || []).reduce((total, item) => total + toNumber(item.sale_fee), 0)
);

export function transformOrderToRow(order) {
  const payments = order.payments || [];
  const pago = calculateProductRevenue(order, payments);
  const recargoMp = calculateMercadoPagoFee(order);
  const retencionIibb = toNumber(order._iibb);
  const impSirtac = toNumber(order._sirtac);
  const sumaImpuestos = retencionIibb + impSirtac;
  const costoEnvio = sumPaymentsField(payments, 'shipping_cost') || toNumber(order.shipping?.cost);
  const neto = pago - (recargoMp + retencionIibb + impSirtac + costoEnvio);

  return [
    String(order.id || ''),
    order.date_created || '',
    `${order.buyer?.first_name || ''} ${order.buyer?.last_name || ''}`.trim() || order.buyer?.nickname || '',
    pago,
    recargoMp,
    retencionIibb,
    impSirtac,
    sumaImpuestos,
    costoEnvio,
    neto,
    order.shipping?.receiver_address?.city?.name || '',
    order.shipping?._state?.name || '',
    'ML',
  ];
}

function mergePackOrders(orders) {
  if (orders.length === 1) return orders[0];
  const first = orders[0];
  return {
    ...first,
    id: first.pack_id || first.id,
    payments: orders.flatMap((o) => o.payments || []),
    order_items: orders.flatMap((o) => o.order_items || []),
    _iibb: orders.reduce((sum, o) => sum + toNumber(o._iibb), 0),
    _sirtac: orders.reduce((sum, o) => sum + toNumber(o._sirtac), 0),
  };
}

function groupOrdersByPack(orders) {
  const groups = new Map();
  for (const order of orders) {
    const key = String(order.pack_id || order.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  }
  return Array.from(groups.values()).map(mergePackOrders);
}

export function transformOrdersToRows(orders) {
  return groupOrdersByPack(orders).map(transformOrderToRow);
}
