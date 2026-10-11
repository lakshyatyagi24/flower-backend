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
});
