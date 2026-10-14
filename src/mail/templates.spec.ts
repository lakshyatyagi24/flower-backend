import { orderPlacedHtml, orderPaidHtml, orderShippedHtml, formatInr, adminOrderHtml, adminEnquiryHtml, enquiryReceivedHtml } from './templates';

describe('mail templates', () => {
  it('formats INR', () => {
    expect(formatInr(1234.5)).toBe('₹1,234.50');
  });
  it('order placed includes id, items and total', () => {
    const html = orderPlacedHtml({
      id: 42, total: 1249, subtotal: 1150, shipping: 99, gst: 0, paymentMethod: 'COD',
      customerName: 'Asha', shippingAddress: '12 MG Road', city: 'Delhi', postalCode: '110001',
      items: [{ productName: 'Sunflowers', quantity: 2, unitPrice: 575 }],
    } as any, 'https://freshpetalsindia.com');
    expect(html).toContain('#42');
    expect(html).toContain('Sunflowers');
    expect(html).toContain('₹1,249.00');
    expect(html).toContain('/track-order');
  });
  it('shows a discount line only when a discount was applied, and escapes the code', () => {
    const base = {
      id: 3, total: 900, subtotal: 1000, shipping: 0, gst: 0, paymentMethod: 'COD',
      customerName: 'A', shippingAddress: 'x', city: 'Delhi', postalCode: '110001',
      items: [{ productName: 'Rose', quantity: 1, unitPrice: 1000 }],
    } as any;
    const withCoupon = orderPlacedHtml({ ...base, couponCode: 'SAVE10', discount: 100 }, 'https://s.test');
    expect(withCoupon).toContain('Discount (SAVE10)');
    expect(withCoupon).toContain('-₹100.00');
    expect(orderPaidHtml({ ...base, couponCode: 'SAVE10', discount: 100 }, 'https://s.test')).toContain('Discount (SAVE10)');
    expect(adminOrderHtml({ ...base, couponCode: 'SAVE10', discount: 100 }, 'https://a.test')).toContain('Discount (SAVE10)');
    expect(orderPlacedHtml({ ...base, couponCode: null, discount: 0 }, 'https://s.test')).not.toContain('Discount');
    expect(orderPlacedHtml(base, 'https://s.test')).not.toContain('Discount');
    expect(orderPlacedHtml({ ...base, couponCode: '<b>x</b>', discount: 5 }, 'https://s.test')).not.toContain('<b>x</b>');
  });
  it('escapes user-controlled strings in customer and admin templates', () => {
    const evil = '<script>alert(1)</script>';
    const order = {
      id: 1, total: 1, subtotal: 1, shipping: 0, gst: 0, paymentMethod: 'COD',
      customerName: evil, shippingAddress: evil, city: evil, postalCode: '1',
      items: [{ productName: evil, quantity: 1, unitPrice: 1 }],
    } as any;
    const enq = { id: 2, customerName: evil, customerPhone: evil, customerEmail: evil, productName: evil, quantity: 1, message: evil, city: evil };
    for (const html of [
      orderPlacedHtml(order, 'https://s.test'),
      adminOrderHtml(order, 'https://a.test'),
      enquiryReceivedHtml(evil, 'https://s.test'),
      adminEnquiryHtml(enq, 'https://a.test'),
    ]) {
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    }
  });
});

describe('delivery date in order mails', () => {
  const order = {
    id: 7, total: 100, subtotal: 100, shipping: 0, gst: 0, paymentMethod: 'COD', customerName: 'A',
    shippingAddress: 'x', city: 'Delhi', postalCode: '110001', items: [],
    deliveryDate: new Date('2026-10-14T00:00:00.000Z'),
  } as any;
  it('is shown in placed, paid, shipped and admin mails as a long date', () => {
    for (const html of [
      orderPlacedHtml(order, 'https://s.test'), orderPaidHtml(order, 'https://s.test'),
      orderShippedHtml(order, 'https://s.test'), adminOrderHtml(order, 'https://a.test'),
    ]) {
      expect(html).toContain('Wednesday, 14 October 2026');
    }
  });
  it('is omitted for older orders without one', () => {
    expect(orderPlacedHtml({ ...order, deliveryDate: null }, 'https://s.test')).not.toContain('Delivery date');
  });
});
