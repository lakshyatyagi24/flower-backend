import { NewsletterService, toCsv } from './newsletter.service';

describe('NewsletterService', () => {
  it('subscribes once and welcomes once', async () => {
    const rows: any[] = [];
    const prisma: any = { subscriber: {
      findUnique: async ({ where }: any) => rows.find((r) => r.email === where.email) ?? null,
      create: async ({ data }: any) => { rows.push({ id: rows.length + 1, ...data }); return rows.at(-1); },
    } };
    const mail: any = { sendNewsletterWelcome: jest.fn(async () => undefined) };
    const svc = new NewsletterService(prisma, mail);
    await svc.subscribe('A@B.com', 'footer');
    await svc.subscribe('a@b.com', 'footer');
    expect(rows).toHaveLength(1);
    expect(mail.sendNewsletterWelcome).toHaveBeenCalledTimes(1);
  });

  it('trims and lowercases the email', async () => {
    const rows: any[] = [];
    const prisma: any = { subscriber: {
      findUnique: async ({ where }: any) => rows.find((r) => r.email === where.email) ?? null,
      create: async ({ data }: any) => { rows.push(data); return data; },
    } };
    const mail: any = { sendNewsletterWelcome: jest.fn(async () => undefined) };
    await new NewsletterService(prisma, mail).subscribe('  Foo@Bar.COM ', 'footer');
    expect(rows[0].email).toBe('foo@bar.com');
  });
});

describe('toCsv', () => {
  const d = new Date('2026-01-02T03:04:05.000Z');
  it('emits a header row and plain rows', () => {
    expect(toCsv([{ email: 'a@b.com', source: 'footer', createdAt: d }])).toBe(
      'email,source,createdAt\na@b.com,footer,2026-01-02T03:04:05.000Z',
    );
  });
  it('emits only the header for no rows', () => {
    expect(toCsv([])).toBe('email,source,createdAt');
  });
  it('RFC-4180 quotes fields with commas, quotes and newlines', () => {
    const out = toCsv([{ email: 'a,b@x.com', source: 'say "hi"\nthere', createdAt: d }]);
    expect(out).toContain('"a,b@x.com","say ""hi""\nthere"');
  });
  it.each(['=', '+', '-', '@', '\t', '\r'])('prefixes a single quote for leading %j', (ch) => {
    const out = toCsv([{ email: `${ch}cmd`, source: 'footer', createdAt: d }]);
    const line = out.split('\n')[1];
    expect(line.startsWith(`"'${ch}cmd"`) || line.startsWith(`'${ch}cmd`)).toBe(true);
  });
});
