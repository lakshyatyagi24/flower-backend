import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';

const ENV_KEYS = ['RESEND_API_KEY', 'NODE_ENV', 'ADMIN_NOTIFY_EMAIL', 'PUBLIC_SITE_URL'] as const;

describe('MailService', () => {
  const saved: Record<string, string | undefined> = {};
  let logSpy: jest.SpyInstance; let errSpy: jest.SpyInstance;
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    delete process.env.RESEND_API_KEY;
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    jest.restoreAllMocks();
  });

  const withClient = (send: jest.Mock) => {
    const svc = new MailService();
    (svc as any).client = { emails: { send } };
    return svc;
  };

  it('disabled mode: does not throw, does not call a client, logs recipient+subject', async () => {
    process.env.NODE_ENV = 'test';
    const svc = new MailService();
    await expect(svc.sendPasswordReset('a@b.com', 'https://x.test/reset?token=SECRET')).resolves.toBeUndefined();
    const logged = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(logged).toContain('a@b.com');
    expect(logged).toContain('Reset your Fresh Petals password');
    // non-production: first link is logged for local manual testing
    expect(logged).toContain('https://x.test/reset?token=SECRET');
  });

  it('disabled mode in production never logs the link or HTML', async () => {
    process.env.NODE_ENV = 'production';
    const svc = new MailService();
    await svc.sendPasswordReset('a@b.com', 'https://x.test/reset?token=SECRET');
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((c) => c[0]).join('\n');
    expect(logged).toContain('a@b.com');
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('<html');
  });

  it('logs (does not throw) a provider error object', async () => {
    const send = jest.fn(async () => ({ data: null, error: { message: 'domain not verified' } }));
    const svc = withClient(send);
    await expect(svc.sendNewsletterWelcome('n@x.com')).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain('domain not verified');
    expect(errSpy.mock.calls[0][0]).toContain('n@x.com');
  });

  it('swallows a thrown exception', async () => {
    const send = jest.fn(async () => { throw new Error('network down'); });
    const svc = withClient(send);
    await expect(svc.sendNewsletterWelcome('n@x.com')).resolves.toBeUndefined();
    expect(errSpy.mock.calls[0][0]).toContain('network down');
  });

  it('empty ADMIN_NOTIFY_EMAIL means no admin mail; trailing slash stripped from site url', async () => {
    process.env.ADMIN_NOTIFY_EMAIL = '';
    process.env.PUBLIC_SITE_URL = 'https://shop.test/';
    const send = jest.fn(async () => ({ data: {}, error: null }));
    const svc = withClient(send);
    await svc.sendOrderPlaced({
      id: 7, total: 1, subtotal: 1, shipping: 0, gst: 0, paymentMethod: 'COD', customerEmail: 'c@x.com',
      customerName: 'C', shippingAddress: 'a', city: 'b', postalCode: '1', items: [],
    });
    expect(send).toHaveBeenCalledTimes(1);
    const html: string = (send.mock.calls[0] as any)[0].html;
    expect(html).toContain('https://shop.test/track-order');
    expect(html).not.toContain('shop.test//');
  });

  describe('sendOrderPaid', () => {
    const paidOrder = () => ({
      id: 7, total: 1, subtotal: 1, shipping: 0, gst: 0, paymentMethod: 'RAZORPAY', customerEmail: 'c@x.com',
      customerName: 'C', shippingAddress: 'a', city: 'b', postalCode: '1', items: [] as any,
    });
    const mk = (send: jest.Mock, admin: string) => {
      const svc = new MailService();
      (svc as any).client = { emails: { send } };
      (svc as any).admin = admin;
      return svc;
    };

    it('notifies both customer and admin', async () => {
      const send = jest.fn(async () => ({ data: {}, error: null }));
      await mk(send, 'admin@x.com').sendOrderPaid(paidOrder());
      expect(send.mock.calls.map((c: any) => c[0].to)).toEqual(['c@x.com', 'admin@x.com']);
    });

    it('skips the admin mail when ADMIN_NOTIFY_EMAIL is empty', async () => {
      const send = jest.fn(async () => ({ data: {}, error: null }));
      await mk(send, '').sendOrderPaid(paidOrder());
      expect(send.mock.calls.map((c: any) => c[0].to)).toEqual(['c@x.com']);
    });

    it('customer failure does not stop the admin mail, and vice versa', async () => {
      const o2: any = paidOrder();
      let n = 0;
      Object.defineProperty(o2, 'items', { get() { if (++n === 2) throw new Error('admin only'); return []; } });
      const send2 = jest.fn(async () => ({ data: {}, error: null }));
      await mk(send2, 'admin@x.com').sendOrderPaid(o2);
      expect(send2.mock.calls.map((c: any) => c[0].to)).toEqual(['c@x.com']);

      const send3 = jest.fn(async () => ({ data: {}, error: null }));
      send3.mockImplementationOnce(async () => { throw new Error('provider down'); });
      await expect(mk(send3, 'admin@x.com').sendOrderPaid(paidOrder())).resolves.toBeUndefined();
      expect(send3.mock.calls.map((c: any) => c[0].to)).toEqual(['c@x.com', 'admin@x.com']);
    });
  });

  describe('template failures never throw or reject', () => {
    const order = (over: any = {}) => ({
      id: 7, total: 1, subtotal: 1, shipping: 0, gst: 0, paymentMethod: 'COD', customerEmail: 'c@x.com',
      customerName: 'C', shippingAddress: 'a', city: 'b', postalCode: '1', items: [], ...over,
    });
    const trap = <T extends object>(o: T, key: string): T => {
      Object.defineProperty(o, key, { get() { throw new Error('tpl boom'); } });
      return o;
    };
    const cases: [string, (s: MailService) => any][] = [
      ['sendPasswordReset', (s) => s.sendPasswordReset('a@b.com', { toString() { throw new Error('tpl boom'); } } as any)],
      ['sendOrderPlaced', (s) => s.sendOrderPlaced(order({ items: undefined }))],
      ['sendOrderPaid', (s) => s.sendOrderPaid(order({ items: undefined }))],
      ['sendOrderShipped', (s) => s.sendOrderShipped(trap(order({ trackingNumber: 'T' }), 'customerName'))],
      ['sendEnquiryReceived', (s) => s.sendEnquiryReceived(trap({ id: 1, customerPhone: '1', customerEmail: 'e@x.com', productName: null, quantity: null, message: null, city: null, customerName: 'x' }, 'customerName') as any)],
      ['sendNewsletterWelcome', (s) => { (s as any).site = { replace() { throw new Error('tpl boom'); } }; return s.sendNewsletterWelcome('n@x.com'); }],
    ];
    it.each(cases)('%s', async (_n, call) => {
      for (const withClient_ of [false, true]) {
        errSpy.mockClear();
        const send = jest.fn(async () => ({ data: {}, error: null }));
        const svc = withClient_ ? withClient(send) : new MailService();
        let p: Promise<void>;
        expect(() => { p = call(svc); }).not.toThrow();
        await expect(p!).resolves.toBeUndefined();
        expect(errSpy).toHaveBeenCalled();
        const msg = errSpy.mock.calls.map((c) => c[0]).join('|');
        expect(msg).toMatch(/to=\S+ subject=".+": /);
        expect(msg).not.toContain('<html');
      }
    });

    it('sendOrderPlaced: customer mail failure does not stop the admin mail, and vice versa', async () => {
      process.env.ADMIN_NOTIFY_EMAIL = 'admin@x.com';
      const send = jest.fn(async () => ({ data: {}, error: null }));
      const svc = new MailService();
      (svc as any).client = { emails: { send } };
      (svc as any).admin = 'admin@x.com';
      const o1: any = order();
      Object.defineProperty(o1, 'shippingAddress', { get() { throw new Error('cust only'); } });
      await svc.sendOrderPlaced(o1);
      expect(send.mock.calls.map((c: any) => c[0].to)).toEqual(['admin@x.com']);

      send.mockClear();
      const o2: any = order();
      let n = 0;
      Object.defineProperty(o2, 'items', { get() { if (++n > 0 && n === 2) throw new Error('admin only'); return []; } });
      await svc.sendOrderPlaced(o2);
      expect(send.mock.calls.map((c: any) => c[0].to)).toEqual(['c@x.com']);
    });
  });
});
