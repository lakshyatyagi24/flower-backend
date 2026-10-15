import { NewsletterService } from './newsletter.service';

function make() {
  const prisma: any = {
    subscriber: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
  };
  const mail: any = { sendNewsletterWelcome: jest.fn(async () => undefined) };
  return { svc: new NewsletterService(prisma, mail), prisma, mail };
}

describe('NewsletterService.subscribe edge cases', () => {
  it('a concurrent duplicate (unique violation) is swallowed and sends no second welcome', async () => {
    const { svc, prisma, mail } = make();
    prisma.subscriber.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(svc.subscribe('a@b.com', 'footer')).resolves.toBeUndefined();
    expect(mail.sendNewsletterWelcome).not.toHaveBeenCalled();
  });

  it('any other database error is NOT swallowed', async () => {
    const { svc, prisma } = make();
    const boom = new Error('connection lost');
    prisma.subscriber.create.mockRejectedValue(boom);
    await expect(svc.subscribe('a@b.com', 'footer')).rejects.toBe(boom);
  });

  it('a failing welcome mail never fails the signup', async () => {
    const { svc, mail } = make();
    mail.sendNewsletterWelcome.mockRejectedValue(new Error('resend down'));
    await expect(svc.subscribe('a@b.com', 'footer')).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r));
  });

  it('an existing subscriber is silently accepted: no insert, no mail (callers cannot probe membership)', async () => {
    const { svc, prisma, mail } = make();
    prisma.subscriber.findUnique.mockResolvedValue({ id: 3, email: 'a@b.com' });
    await svc.subscribe('A@B.com', 'footer');
    expect(prisma.subscriber.create).not.toHaveBeenCalled();
    expect(mail.sendNewsletterWelcome).not.toHaveBeenCalled();
  });

  it('records the signup source', async () => {
    const { svc, prisma } = make();
    await svc.subscribe('a@b.com', 'checkout');
    expect(prisma.subscriber.create).toHaveBeenCalledWith({ data: { email: 'a@b.com', source: 'checkout' } });
  });
});

describe('NewsletterService list / export', () => {
  it('caps the page size at 500 and returns the total', async () => {
    const { svc, prisma } = make();
    prisma.subscriber.count.mockResolvedValue(1234);
    const out = await svc.list(100000, 20);
    expect(prisma.subscriber.findMany.mock.calls[0][0]).toMatchObject({ take: 500, skip: 20, orderBy: { createdAt: 'desc' } });
    expect(out.total).toBe(1234);
  });

  it('exports oldest first as CSV', async () => {
    const { svc, prisma } = make();
    prisma.subscriber.findMany.mockResolvedValue([
      { email: 'a@b.com', source: 'footer', createdAt: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    expect(await svc.exportCsv()).toBe('email,source,createdAt\na@b.com,footer,2026-01-01T00:00:00.000Z');
    expect(prisma.subscriber.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
  });
});
