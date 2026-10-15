import { AuthService } from './auth.service';
import { hashPassword, verifyJwt } from './jwt.util';

describe('AuthService session lifetimes', () => {
  const saved = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret-at-least-32-characters-long';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = saved;
  });

  const decode = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

  async function loginAs(role: 'ADMIN' | 'CUSTOMER') {
    const password = await hashPassword('password123');
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 7, email: 'u@x.com', password, role, name: null, phone: null, createdAt: new Date(),
        })),
      },
    };
    return new AuthService(prisma, {} as any).login({ email: 'u@x.com', password: 'password123' });
  }

  it('ADMIN tokens expire after 12 hours and keep the ADMIN role claim', async () => {
    const { token, user } = await loginAs('ADMIN');
    const p = decode(token);
    expect(p.exp - p.iat).toBe(12 * 60 * 60);
    expect(p).toMatchObject({ sub: 7, email: 'u@x.com', role: 'ADMIN' });
    expect(user.role).toBe('ADMIN');
  });

  it('CUSTOMER tokens keep the 7 day lifetime and the CUSTOMER role claim', async () => {
    const { token } = await loginAs('CUSTOMER');
    const p = decode(token);
    expect(p.exp - p.iat).toBe(7 * 24 * 60 * 60);
    expect(p.role).toBe('CUSTOMER');
  });

  it('register issues a 7 day CUSTOMER token', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 9, role: 'CUSTOMER', name: null, phone: null, createdAt: new Date(), ...data })),
      },
    };
    const { token } = await new AuthService(prisma, {} as any).register({ email: 'n@x.com', password: 'password123' });
    const p = decode(token);
    expect(p.exp - p.iat).toBe(7 * 24 * 60 * 60);
    expect(p.role).toBe('CUSTOMER');
  });

  it('an ADMIN token is rejected once 12 hours have passed (verifyJwt checks exp)', async () => {
    const password = await hashPassword('password123');
    jest.useFakeTimers({ now: new Date('2026-10-15T00:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'] });
    try {
      const prisma: any = {
        user: { findUnique: jest.fn(async () => ({ id: 7, email: 'u@x.com', password, role: 'ADMIN', name: null, phone: null, createdAt: new Date() })) },
      };
      const { token } = await new AuthService(prisma, {} as any).login({ email: 'u@x.com', password: 'password123' });
      jest.setSystemTime(new Date('2026-10-15T11:59:00Z'));
      expect(verifyJwt(token)).not.toBeNull();
      jest.setSystemTime(new Date('2026-10-15T12:00:02Z'));
      expect(verifyJwt(token)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
