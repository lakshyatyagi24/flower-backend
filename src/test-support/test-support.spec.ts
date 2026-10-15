import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Module } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { testSupportModules } from './test-support.env';
import { TestSupportModule } from './test-support.module';
import { InMemoryResetTokenStore } from './reset-token-sink';
import { createHash } from 'crypto';

const ON = { NODE_ENV: 'test', ENABLE_TEST_ENDPOINTS: '1' };

describe('testSupportModules (env gating)', () => {
  it('registers the module only with NODE_ENV=test AND ENABLE_TEST_ENDPOINTS=1', () => {
    expect(testSupportModules(ON)).toEqual([TestSupportModule]);
  });

  it.each([
    ['no env', {}],
    ['flag only', { ENABLE_TEST_ENDPOINTS: '1' }],
    ['test env only', { NODE_ENV: 'test' }],
    ['development + flag', { NODE_ENV: 'development', ENABLE_TEST_ENDPOINTS: '1' }],
    ['test + flag=true', { NODE_ENV: 'test', ENABLE_TEST_ENDPOINTS: 'true' }],
    ['test + flag=0', { NODE_ENV: 'test', ENABLE_TEST_ENDPOINTS: '0' }],
    ['production without flag', { NODE_ENV: 'production' }],
    ['production with empty flag', { NODE_ENV: 'production', ENABLE_TEST_ENDPOINTS: '' }],
  ])('does not register the module: %s', (_n, env) => {
    expect(testSupportModules(env)).toEqual([]);
  });

  it.each(['1', '0', 'true', 'yes'])('refuses to boot in production when the flag is %s', (v) => {
    expect(() => testSupportModules({ NODE_ENV: 'production', ENABLE_TEST_ENDPOINTS: v })).toThrow(
      /ENABLE_TEST_ENDPOINTS must not be set when NODE_ENV=production/,
    );
  });
});

describe('GET /auth/_test/last-reset-token', () => {
  const users = new Map<string, any>([['a@b.com', { id: 1, email: 'a@b.com', role: 'CUSTOMER' }]]);
  const created: any[] = [];
  const prisma = {
    user: { findUnique: jest.fn(async ({ where }: any) => users.get(where.email) ?? null) },
    passwordResetToken: { create: jest.fn(async ({ data }: any) => { created.push(data); return data; }) },
  };
  const mail = { sendPasswordReset: jest.fn(async () => undefined) };

  async function boot(env: Record<string, string | undefined>) {
    @Module({
      imports: [...testSupportModules(env)],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
      ],
    })
    class Harness {}
    const mod = await Test.createTestingModule({ imports: [Harness] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    return { app, auth: mod.get(AuthService) };
  }

  let app: INestApplication | undefined;
  afterEach(async () => { await app?.close(); app = undefined; created.length = 0; });

  it('route is not registered when the gate is off (404 even after a token was generated)', async () => {
    const b = await boot({ NODE_ENV: 'development', ENABLE_TEST_ENDPOINTS: '1' });
    app = b.app;
    await b.auth.forgotPassword('a@b.com');
    await request(app.getHttpServer()).get('/auth/_test/last-reset-token?email=a@b.com').expect(404);
    expect(() => app!.get(InMemoryResetTokenStore)).toThrow();
  });

  it('returns the last plaintext token for the email, 404 otherwise', async () => {
    const b = await boot(ON);
    app = b.app;
    const http = app.getHttpServer();
    await request(http).get('/auth/_test/last-reset-token?email=a@b.com').expect(404);
    await request(http).get('/auth/_test/last-reset-token').expect(404);

    await b.auth.forgotPassword('a@b.com');
    const first = await request(http).get('/auth/_test/last-reset-token?email=A@B.com').expect(200);
    expect(first.body.token).toMatch(/^[0-9a-f]{64}$/);
    // Real storage is still the hash only.
    expect(created[0].tokenHash).toBe(createHash('sha256').update(first.body.token).digest('hex'));
    expect(JSON.stringify(created[0])).not.toContain(first.body.token);
    const urlSent: string = (mail.sendPasswordReset.mock.calls.at(-1) as any)[1];
    expect(urlSent).toContain(first.body.token);

    await b.auth.forgotPassword('a@b.com');
    const second = await request(http).get('/auth/_test/last-reset-token?email=a@b.com').expect(200);
    expect(second.body.token).not.toBe(first.body.token);

    await request(http).get('/auth/_test/last-reset-token?email=nobody@x.com').expect(404);
  });

  it('AuthService works without a sink (production wiring)', async () => {
    const svc = new AuthService(prisma as any, mail as any);
    await expect(svc.forgotPassword('a@b.com')).resolves.toBeUndefined();
  });
});

describe('AppModule boot guard', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('importing AppModule throws in production when ENABLE_TEST_ENDPOINTS is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_TEST_ENDPOINTS = '1';
    jest.isolateModules(() => {
      expect(() => require('../app.module')).toThrow(/ENABLE_TEST_ENDPOINTS must not be set/);
    });
  });

  it('importing AppModule is fine in production without the flag', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_TEST_ENDPOINTS;
    jest.isolateModules(() => {
      expect(() => require('../app.module')).not.toThrow();
    });
  });
});
