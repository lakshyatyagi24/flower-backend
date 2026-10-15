import { exportFilename, formatIst, ORDER_CSV_HEADERS, orderCsvRow, ordersToCsv, type ExportOrder } from './orders-csv';

const base: ExportOrder = {
  id: 42,
  createdAt: new Date('2026-10-14T18:29:59Z'), // 23:59 IST on the 14th
  status: 'PAID',
  paymentMethod: 'RAZORPAY',
  paymentStatus: 'PAID',
  customerName: 'Asha Rao',
  customerEmail: 'asha@example.com',
  customerPhone: '9876543210',
  city: 'Delhi',
  postalCode: '110001',
  deliveryDate: new Date('2026-10-16T00:00:00Z'),
  items: [{ productName: 'Red Roses', quantity: 2 }, { productName: 'Tulips', quantity: 1 }],
  subtotal: 1000.005,
  discount: 100,
  couponCode: 'SAVE10',
  shipping: 50,
  gst: 45,
  total: 995,
  trackingNumber: 'AWB1',
  courierName: 'Delhivery',
};

describe('orders CSV', () => {
  it('formats createdAt in IST and the delivery date as stored', () => {
    expect(formatIst(new Date('2026-10-14T18:29:59Z'))).toBe('2026-10-14 23:59');
    expect(formatIst(new Date('2026-10-14T18:30:00Z'))).toBe('2026-10-15 00:00');
    expect(orderCsvRow(base)).toBe(
      '42,2026-10-14 23:59,PAID,RAZORPAY,PAID,Asha Rao,asha@example.com,9876543210,Delhi,110001,2026-10-16,' +
        '2 x Red Roses; 1 x Tulips,1000.01,100,SAVE10,50,45,995,Delhivery AWB1',
    );
  });

  it('starts with the BOM, has the documented columns, and ends every line with CRLF', () => {
    const out = ordersToCsv([base]);
    expect(out.startsWith('﻿')).toBe(true);
    const lines = out.slice(1).split('\r\n');
    expect(lines[0]).toBe(ORDER_CSV_HEADERS.join(','));
    expect(lines[0].split(',')).toHaveLength(19);
    expect(lines).toHaveLength(3); // header, 1 row, trailing empty
    expect(lines[2]).toBe('');
  });

  it('empty result is just BOM + header', () => {
    expect(ordersToCsv([])).toBe(`﻿${ORDER_CSV_HEADERS.join(',')}\r\n`);
  });

  it('neutralises formula-injection in customer-controlled cells', () => {
    const row = orderCsvRow({
      ...base,
      customerName: "=cmd|' /C calc'!A0",
      customerEmail: '+evil@x.com',
      city: '-2+3',
      postalCode: '@SUM(A1)',
      customerPhone: '\t123',
      items: [{ productName: '=1+1', quantity: 1 }],
    });
    expect(row).toContain(`'=cmd|' /C calc'!A0`);
    expect(row).toContain(",'+evil@x.com,");
    expect(row).toContain(",'-2+3,");
    expect(row).toContain(",'@SUM(A1),");
    expect(row).toContain(",'\t123,");
    expect(row).toContain(',1 x =1+1,'); // not at the start of the cell, so no prefix is needed
  });

  it('quotes commas, quotes and newlines in names, addresses and item names', () => {
    const row = orderCsvRow({
      ...base,
      customerName: 'Rao, Asha "AR"',
      city: 'New\nDelhi',
      items: [{ productName: 'Roses, red', quantity: 3 }],
    });
    expect(row).toContain('"Rao, Asha ""AR"""');
    expect(row).toContain('"New\nDelhi"');
    expect(row).toContain('"3 x Roses, red"');
  });

  it('missing optional values become empty cells', () => {
    const row = orderCsvRow({
      ...base, customerName: null, customerEmail: null, customerPhone: null, city: null, postalCode: null,
      deliveryDate: null, couponCode: null, trackingNumber: null, courierName: null, items: [],
    });
    expect(row).toBe('42,2026-10-14 23:59,PAID,RAZORPAY,PAID,,,,,,,,1000.01,100,,50,45,995,');
  });

  it('names the file with the IST date', () => {
    expect(exportFilename(new Date('2026-10-14T18:30:00Z'))).toBe('orders-2026-10-15.csv');
    expect(exportFilename(new Date('2026-10-14T18:29:59Z'))).toBe('orders-2026-10-14.csv');
  });
});
