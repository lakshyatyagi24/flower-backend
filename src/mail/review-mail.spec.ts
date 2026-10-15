import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';

describe('MailService.sendReviewPending', () => {
  const saved = process.env.ADMIN_NOTIFY_EMAIL;
  afterEach(() => {
    if (saved === undefined) delete process.env.ADMIN_NOTIFY_EMAIL;
    else process.env.ADMIN_NOTIFY_EMAIL = saved;
    jest.restoreAllMocks();
  });
  const review = {
    id: 3,
    productName: 'Rose\r\nBcc: x@evil.test',
    rating: 4,
    title: '<script>t</script>',
    body: '<img src=x onerror=alert(1)> & more',
    authorName: '"><b>Eve</b>',
    edited: false,
  };

  it('escapes all user text in the HTML and strips line breaks from the subject', async () => {
    process.env.ADMIN_NOTIFY_EMAIL = 'owner@shop.test';
    const send = jest.fn(async (_m: any) => ({ error: null }));
    const svc = new MailService();
    (svc as any).client = { emails: { send } };
    await svc.sendReviewPending(review);
    const arg = send.mock.calls[0][0];
    expect(arg.to).toBe('owner@shop.test');
    expect(arg.subject).not.toMatch(/[\r\n]/);
    expect(arg.html).not.toContain('<script>');
    expect(arg.html).not.toContain('<img');
    expect(arg.html).not.toContain('<b>Eve');
    expect(arg.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; more');
    expect(arg.html).toContain('/reviews');
  });

  it('is skipped when no admin email is configured, and never rejects on provider failure', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    delete process.env.ADMIN_NOTIFY_EMAIL;
    const send = jest.fn(async (_m: any) => {
      throw new Error('boom');
    });
    const none = new MailService();
    (none as any).client = { emails: { send } };
    await expect(none.sendReviewPending(review)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    process.env.ADMIN_NOTIFY_EMAIL = 'owner@shop.test';
    const svc = new MailService();
    (svc as any).client = { emails: { send } };
    await expect(svc.sendReviewPending(review)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
