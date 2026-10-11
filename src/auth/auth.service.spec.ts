import { AuthService } from './auth.service';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { verifyPassword } from './jwt.util';

function makePrisma() {
  const users = new Map<string, any>();
  const tokens: any[] = [];
  return {
    _users: users, _tokens: tokens,
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.email ? users.get(where.email) ?? null : [...users.values()].find((u) => u.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => { const u = [...users.values()].find((x) => x.id === where.id); Object.assign(u, data); return u; }),
    },
    passwordResetToken: {
      create: jest.fn(async ({ data }: any) => { tokens.push({ id: tokens.length + 1, usedAt: null, ...data }); return tokens.at(-1); }),
      findUnique: jest.fn(async ({ where }: any) => tokens.find((t) => t.tokenHash === where.tokenHash) ?? null),
      deleteMany: jest.fn(async ({ where }: any) => { const n = tokens.filter((t) => t.userId === where.userId).length; tokens.splice(0, tokens.length, ...tokens.filter((t) => t.userId !== where.userId)); return { count: n }; }),
    },
    $transaction: jest.fn(async (fn: any) => fn(makePrismaTx())),
  };
  function makePrismaTx() {
    return {
      user: { update: async ({ where, data }: any) => { const u = [...users.values()].find((x) => x.id === where.id); Object.assign(u, data); return u; } },
      passwordResetToken: {
        findUnique: async ({ where }: any) => tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
        deleteMany: async ({ where }: any) => {
          const match = (t: any) => (where.id !== undefined ? t.id === where.id : t.userId === where.userId);
          const n = tokens.filter(match).length;
          tokens.splice(0, tokens.length, ...tokens.filter((t) => !match(t)));
          return { count: n };
        },
      },
    };
  }
}

describe('AuthService password reset', () => {
  let prisma: any; let mail: any; let svc: AuthService;
  beforeEach(() => {
    prisma = makePrisma();
    prisma._users.set('a@b.com', { id: 1, email: 'a@b.com', password: 'old', role: 'CUSTOMER', name: null, phone: null, createdAt: new Date() });
    mail = { sendPasswordReset: jest.fn(async () => undefined) };
    svc = new AuthService(prisma, mail);
  });

  it('forgot: unknown email resolves without sending', async () => {
    await expect(svc.forgotPassword('nobody@x.com')).resolves.toBeUndefined();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('forgot: known email stores a hashed token and emails a link', async () => {
    await svc.forgotPassword('a@b.com');
    expect(prisma._tokens).toHaveLength(1);
    const url: string = mail.sendPasswordReset.mock.calls[0][1];
    const raw = new URL(url).searchParams.get('token')!;
    expect(prisma._tokens[0].tokenHash).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  it('reset: valid token changes password once', async () => {
    await svc.forgotPassword('a@b.com');
    const raw = new URL(mail.sendPasswordReset.mock.calls[0][1]).searchParams.get('token')!;
    await svc.resetPassword(raw, 'newpassword123');
    expect(await verifyPassword('newpassword123', prisma._users.get('a@b.com').password)).toBe(true);
    await expect(svc.resetPassword(raw, 'another12345')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reset: expired token rejected', async () => {
    await svc.forgotPassword('a@b.com');
    prisma._tokens[0].expiresAt = new Date(Date.now() - 1000);
    const raw = new URL(mail.sendPasswordReset.mock.calls[0][1]).searchParams.get('token')!;
    await expect(svc.resetPassword(raw, 'newpassword123')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reset: removes all other tokens of the same user', async () => {
    await svc.forgotPassword('a@b.com');
    await svc.forgotPassword('a@b.com');
    expect(prisma._tokens).toHaveLength(2);
    const raw = new URL(mail.sendPasswordReset.mock.calls[0][1]).searchParams.get('token')!;
    await svc.resetPassword(raw, 'newpassword123');
    expect(prisma._tokens).toHaveLength(0);
  });

  it('reset: concurrent double-use succeeds exactly once', async () => {
    await svc.forgotPassword('a@b.com');
    const raw = new URL(mail.sendPasswordReset.mock.calls[0][1]).searchParams.get('token')!;
    const results = await Promise.allSettled([
      svc.resetPassword(raw, 'newpassword123'),
      svc.resetPassword(raw, 'otherpassword456'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BadRequestException);
  });

  describe('reset URL', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; });
    const urlFor = async () => { await svc.forgotPassword('a@b.com'); return new URL(mail.sendPasswordReset.mock.calls[0][1]); };

    it('customer: uses PUBLIC_SITE_URL, strips trailing slash', async () => {
      process.env.PUBLIC_SITE_URL = 'https://shop.example.com/';
      const u = await urlFor();
      expect(u.origin).toBe('https://shop.example.com');
      expect(u.pathname).toBe('/account/reset-password');
    });
    it('admin: uses ADMIN_SITE_URL and /reset-password', async () => {
      prisma._users.get('a@b.com').role = 'ADMIN';
      process.env.ADMIN_SITE_URL = 'https://admin.example.com//';
      const u = await urlFor();
      expect(u.origin).toBe('https://admin.example.com');
      expect(u.pathname).toBe('/reset-password');
    });
    it('empty env strings fall back to localhost defaults', async () => {
      process.env.PUBLIC_SITE_URL = '';
      const u = await urlFor();
      expect(u.origin).toBe('http://localhost:3000');
      prisma._users.get('a@b.com').role = 'ADMIN';
      mail.sendPasswordReset.mockClear();
      process.env.ADMIN_SITE_URL = '';
      const a = await urlFor();
      expect(a.origin).toBe('http://localhost:3002');
    });
  });
});
