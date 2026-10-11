import { orderPlacedHtml, formatInr, adminOrderHtml, adminEnquiryHtml, enquiryReceivedHtml } from './templates';

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
