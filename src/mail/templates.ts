import { formatDeliveryDate } from '../delivery/delivery-date';

type OrderLike = {
  id: number; total: number; subtotal: number; shipping: number; gst: number; paymentMethod: string;
  customerName: string | null; shippingAddress: string | null; city: string | null; postalCode: string | null;
  trackingNumber?: string | null; courierName?: string | null;
  /** Coupon applied at checkout (absent/0 on orders placed before coupons existed). */
  couponCode?: string | null; discount?: number | null;
  /** UTC midnight of the chosen IST date (null for orders placed before delivery dates existed). */
  deliveryDate?: Date | string | null;
  items: { productName: string; quantity: number; unitPrice: number }[];
};

export function formatInr(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// `title` is escaped here; callers must pass it raw (never pre-escaped).
function layout(title: string, body: string, siteUrl: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F6F2EC;font-family:Georgia,serif;color:#1C1B19">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
  <h1 style="font-weight:400;font-size:24px;letter-spacing:.02em;margin:0 0 24px"><a href="${siteUrl}" style="color:#1C1B19;text-decoration:none">Fresh Petals</a></h1>
  <h2 style="font-weight:400;font-size:20px;margin:0 0 16px">${esc(title)}</h2>
  ${body}
  <p style="font-size:12px;color:#8C8577;margin-top:32px">Fresh Petals India · <a href="${siteUrl}" style="color:#8C8577">${siteUrl.replace(/^https?:\/\//, '')}</a></p>
</div></body></html>`;
}

function deliveryLine(o: OrderLike): string {
  const d = formatDeliveryDate(o.deliveryDate);
  return d ? `<p style="font-size:14px">Delivery date: <strong>${esc(d)}</strong></p>` : '';
}

function discountRow(o: OrderLike): string {
  const d = o.discount ?? 0;
  if (!(d > 0)) return '';
  const label = o.couponCode ? `Discount (${esc(o.couponCode)})` : 'Discount';
  return `<tr><td>${label}</td><td align="right">-${formatInr(d)}</td></tr>`;
}

function itemsTable(o: OrderLike): string {
  const rows = o.items.map((i) => `<tr><td style="padding:6px 0">${esc(i.productName)} × ${i.quantity}</td><td align="right">${formatInr(i.unitPrice * i.quantity)}</td></tr>`).join('');
  return `<table width="100%" style="border-collapse:collapse;font-size:14px">${rows}
<tr><td style="padding-top:12px;border-top:1px solid #ddd">Subtotal</td><td align="right" style="padding-top:12px;border-top:1px solid #ddd">${formatInr(o.subtotal)}</td></tr>
${discountRow(o)}
<tr><td>GST</td><td align="right">${formatInr(o.gst)}</td></tr>
<tr><td>Delivery</td><td align="right">${formatInr(o.shipping)}</td></tr>
<tr><td style="font-weight:bold">Total</td><td align="right" style="font-weight:bold">${formatInr(o.total)}</td></tr></table>`;
}

export function orderPlacedHtml(o: OrderLike, siteUrl: string): string {
  const pay = o.paymentMethod === 'COD' ? 'Pay on delivery.' : 'Paid online.';
  return layout(`Order #${o.id} received`, `
<p>Hi ${esc(o.customerName)}, thank you. We are preparing your flowers.</p>
${itemsTable(o)}
${deliveryLine(o)}
<p style="font-size:14px">${pay}<br>Deliver to: ${esc(o.shippingAddress)}, ${esc(o.city)} ${esc(o.postalCode)}</p>
<p><a href="${siteUrl}/track-order" style="display:inline-block;padding:12px 20px;background:#1C1B19;color:#fff;text-decoration:none">Track your order</a></p>`, siteUrl);
}

export function orderPaidHtml(o: OrderLike, siteUrl: string): string {
  return layout(`Payment received for order #${o.id}`, `<p>Hi ${esc(o.customerName)}, your payment of ${formatInr(o.total)} is confirmed.</p>${deliveryLine(o)}${itemsTable(o)}
<p><a href="${siteUrl}/track-order">Track your order</a></p>`, siteUrl);
}

export function orderShippedHtml(o: OrderLike, siteUrl: string): string {
  const t = o.trackingNumber ? `<p>Courier: ${esc(o.courierName)} · Tracking: ${esc(o.trackingNumber)}</p>` : '';
  return layout(`Order #${o.id} is on its way`, `<p>Hi ${esc(o.customerName)}, your flowers have left our studio.</p>${deliveryLine(o)}${t}
<p><a href="${siteUrl}/track-order">Track your order</a></p>`, siteUrl);
}

export function adminOrderHtml(o: OrderLike, adminUrl: string): string {
  return layout(`New order #${o.id} — ${formatInr(o.total)} (${o.paymentMethod})`, `
<p>${esc(o.customerName)} · ${esc(o.city)} ${esc(o.postalCode)}</p>${deliveryLine(o)}${itemsTable(o)}
<p><a href="${adminUrl}/orders">Open in admin</a></p>`, adminUrl);
}

export function enquiryReceivedHtml(name: string, siteUrl: string): string {
  return layout('We received your enquiry', `<p>Hi ${esc(name)}, thanks for reaching out. We reply within one working day with a quote.</p>`, siteUrl);
}

export function adminEnquiryHtml(e: { id: number; customerName: string; customerPhone: string; customerEmail: string | null; productName: string | null; quantity: number | null; message: string | null; city: string | null }, adminUrl: string): string {
  return layout(`New enquiry #${e.id} from ${e.customerName}`, `
<p>Phone: ${esc(e.customerPhone)}<br>Email: ${esc(e.customerEmail)}<br>Product: ${esc(e.productName)} × ${e.quantity ?? '-'}<br>City: ${esc(e.city)}</p>
<p>${esc(e.message)}</p><p><a href="${adminUrl}/enquiries">Open in admin</a></p>`, adminUrl);
}

export function passwordResetHtml(url: string, siteUrl: string): string {
  return layout('Reset your password', `<p>Click the button below within 1 hour to set a new password. If you did not ask for this, ignore this email.</p>
<p><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;background:#1C1B19;color:#fff;text-decoration:none">Reset password</a></p>`, siteUrl);
}

export function newsletterWelcomeHtml(siteUrl: string): string {
  return layout('Welcome to Fresh Petals', `<p>You are on the list. Seasonal stems, studio news and occasional offers — never spam.</p><p><a href="${siteUrl}/products">Shop fresh cut flowers</a></p>`, siteUrl);
}

export function adminReviewPendingHtml(
  r: { id: number; productName: string; rating: number; title: string | null; body: string; authorName: string | null; edited: boolean },
  adminUrl: string,
): string {
  const stars = '★'.repeat(r.rating) + '☆'.repeat(Math.max(0, 5 - r.rating));
  return layout(r.edited ? 'A review was edited and needs approval' : 'New review awaiting approval', `
<p>Product: <strong>${esc(r.productName)}</strong><br>From: ${esc(r.authorName)}<br>Rating: ${stars} (${r.rating}/5)</p>
${r.title ? `<p><strong>${esc(r.title)}</strong></p>` : ''}
<p style="white-space:pre-wrap">${esc(r.body)}</p>
<p><a href="${adminUrl}/reviews">Open the review queue</a></p>`, adminUrl);
}
