import { CSV_BOM, csvRow } from '../common/csv';
import { round2 } from '../common/money';
import { IST_OFFSET_MINUTES, istNow } from '../delivery/delivery-date';

/** Hard cap on exported rows; the controller tells the admin when the result was truncated. */
export const EXPORT_ROW_CAP = 5000;

export const ORDER_CSV_HEADERS = [
  'id', 'createdAt (IST)', 'status', 'paymentMethod', 'paymentStatus', 'name', 'email', 'phone', 'city',
  'pincode', 'deliveryDate', 'items', 'subtotal', 'discount', 'coupon', 'shipping', 'gst', 'total', 'tracking',
] as const;

export interface ExportOrder {
  id: number;
  createdAt: Date;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  city: string | null;
  postalCode: string | null;
  deliveryDate: Date | null;
  items: { productName: string; quantity: number }[];
  subtotal: number;
  discount: number;
  couponCode: string | null;
  shipping: number;
  gst: number;
  total: number;
  trackingNumber: string | null;
  courierName: string | null;
}

/** `YYYY-MM-DD HH:mm` in India time. */
export function formatIst(d: Date): string {
  const s = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
}

export function orderCsvRow(o: ExportOrder): string {
  const tracking = [o.courierName, o.trackingNumber].filter(Boolean).join(' ');
  return csvRow([
    o.id,
    formatIst(o.createdAt),
    o.status,
    o.paymentMethod,
    o.paymentStatus,
    o.customerName,
    o.customerEmail,
    o.customerPhone,
    o.city,
    o.postalCode,
    // deliveryDate is stored as UTC midnight of the chosen IST calendar date.
    o.deliveryDate ? o.deliveryDate.toISOString().slice(0, 10) : '',
    o.items.map((i) => `${i.quantity} x ${i.productName}`).join('; '),
    round2(o.subtotal),
    round2(o.discount),
    o.couponCode,
    round2(o.shipping),
    round2(o.gst),
    round2(o.total),
    tracking,
  ]);
}

/** BOM + header + one CRLF-terminated line per order (RFC 4180). */
export function ordersToCsv(orders: ExportOrder[]): string {
  return CSV_BOM + [csvRow([...ORDER_CSV_HEADERS]), ...orders.map(orderCsvRow)].join('\r\n') + '\r\n';
}

export function exportFilename(now: Date = new Date()): string {
  return `orders-${istNow(now).date}.csv`;
}
