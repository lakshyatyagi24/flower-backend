/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { buildSentryOptions, initSentry, sentryEnabled } from './sentry';
import {
  REDACTED,
  isExpectedClientError,
  redactString,
  scrubEvent,
} from './sentry-scrub';
import { sentryNestWiring } from './sentry-nest';

describe('initSentry', () => {
  it('is skipped without a DSN (init never called)', () => {
    const init = jest.fn();
    expect(initSentry({}, init)).toBe(false);
    expect(initSentry({ SENTRY_DSN_API: '   ' }, init)).toBe(false);
    expect(init).not.toHaveBeenCalled();
    expect(sentryEnabled({})).toBe(false);
  });

  it('initialises with privacy-safe options when the DSN is set', () => {
    const init = jest.fn();
    expect(
      initSentry(
        {
          SENTRY_DSN_API: 'https://k@o1.ingest.sentry.io/1',
          NODE_ENV: 'production',
          SENTRY_RELEASE: 'abc123',
        },
        init,
      ),
    ).toBe(true);
    const opts = init.mock.calls[0][0];
    expect(opts).toMatchObject({
      dsn: 'https://k@o1.ingest.sentry.io/1',
      environment: 'production',
      release: 'abc123',
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
    });
  });

  it('falls back to GIT_SHA for the release', () => {
    expect(
      buildSentryOptions({ SENTRY_DSN_API: 'x', GIT_SHA: 'deadbee' }).release,
    ).toBe('deadbee');
  });
});

describe('sentryNestWiring', () => {
  it('registers nothing without a DSN', () => {
    expect(sentryNestWiring({})).toEqual({ imports: [], providers: [] });
  });
  it('registers module + global filter with a DSN', () => {
    const w = sentryNestWiring({
      SENTRY_DSN_API: 'https://k@o1.ingest.sentry.io/1',
    });
    expect(w.imports).toHaveLength(1);
    expect(w.providers).toHaveLength(1);
  });
});

describe('scrubEvent', () => {
  const dirty = () => ({
    message: 'failed for jane@example.com with Bearer abc.def.ghi',
    request: {
      url: 'https://api.freshpetalsindia.com/auth/reset?token=SECRET123&x=1',
      query_string: 'token=SECRET123',
      cookies: { session: 'abc' },
      data: { email: 'jane@example.com', password: 'hunter2' },
      headers: {
        Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
        cookie: 'a=b',
        'x-razorpay-signature': 'sig',
        'content-type': 'application/json',
      },
    },
    user: { id: 7, email: 'jane@example.com', ip_address: '1.2.3.4' },
    exception: { values: [{ value: 'Invalid user bob@example.org' }] },
    extra: { password: 'p', note: 'ok', nested: { api_key: 'k', fine: 1 } },
    breadcrumbs: [
      {
        message: 'GET /x?token=abc',
        data: { url: '/y?email=a@b.co', authorization: 'z' },
      },
    ],
    server_name: 'host',
  });

  it('removes bodies, cookies and secret headers', () => {
    const e: any = scrubEvent(dirty());
    expect(e.request.data).toBeUndefined();
    expect(e.request.cookies).toBeUndefined();
    expect(e.request.headers.Authorization).toBe(REDACTED);
    expect(e.request.headers.cookie).toBe(REDACTED);
    expect(e.request.headers['x-razorpay-signature']).toBe(REDACTED);
    expect(e.request.headers['content-type']).toBe('application/json');
    expect(e.request.query_string).toBe(REDACTED);
    expect(e.request.url).not.toContain('SECRET123');
    expect(e.server_name).toBeUndefined();
  });

  it('redacts emails/tokens in messages, exceptions, extra and breadcrumbs', () => {
    const e: any = scrubEvent(dirty());
    expect(JSON.stringify(e)).not.toMatch(
      /jane@example|bob@example|hunter2|SECRET123|eyJhbGci|abc\.def\.ghi|a@b\.co/,
    );
    expect(e.extra.password).toBe(REDACTED);
    expect(e.extra.nested.api_key).toBe(REDACTED);
    expect(e.extra.note).toBe('ok');
    expect(e.breadcrumbs[0].data.authorization).toBe(REDACTED);
  });

  it('keeps only an opaque user id', () => {
    expect((scrubEvent(dirty()) as any).user).toEqual({ id: '7' });
    expect(
      (scrubEvent({ user: { email: 'a@b.co' } }) as any).user,
    ).toBeUndefined();
  });

  it('redactString handles query secrets and JWTs', () => {
    expect(redactString('/a?code=123&b=2')).toBe(`/a?code=${REDACTED}&b=2`);
  });
});

describe('beforeSend', () => {
  const opts: any = buildSentryOptions({ SENTRY_DSN_API: 'x' });
  const http = (status: number) => ({ getStatus: () => status });

  it('drops expected client errors (4xx HttpException incl. 401/403/404/429)', () => {
    for (const s of [400, 401, 403, 404, 429]) {
      expect(
        opts.beforeSend({ message: 'm' }, { originalException: http(s) }),
      ).toBeNull();
      expect(isExpectedClientError(http(s))).toBe(true);
    }
  });

  it('keeps 5xx and unknown errors, scrubbed', () => {
    expect(isExpectedClientError(http(500))).toBe(false);
    const out = opts.beforeSend(
      { message: 'boom a@b.co', request: { data: { x: 1 } } },
      { originalException: new Error('x') },
    );
    expect(out.message).toBe(`boom ${REDACTED}`);
    expect(out.request.data).toBeUndefined();
  });

  it('declares ignoreErrors for known noise', () => {
    expect(
      opts.ignoreErrors.some((r: RegExp) =>
        r.test('ThrottlerException: Too Many Requests'),
      ),
    ).toBe(true);
  });
});

describe('scrubbing gaps (fix round)', () => {
  const opts: any = buildSentryOptions({ SENTRY_DSN_API: 'x' });

  it('strips the query string from request.url (admin order search leaks phones otherwise)', () => {
    const e: any = scrubEvent({
      request: {
        url: 'https://api.freshpetalsindia.com/orders?q=9876543210&page=2',
      },
      transaction: 'GET /orders?q=9876543210',
    });
    expect(e.request.url).toBe('https://api.freshpetalsindia.com/orders');
    expect(e.transaction).toBe('GET /orders');
  });

  it('scrubs span description and data (urls, queries, sql)', () => {
    const e: any = scrubEvent({
      spans: [
        {
          description: 'GET https://api.resend.com/emails?to=a@b.co',
          data: {
            'url.full': 'https://x.test/orders?q=9876543210',
            'http.query': 'q=9876543210',
            'http.url': 'https://x.test/a?email=a@b.co',
            'http.target': '/orders?q=9876543210',
            'db.statement': 'select * from "User" where phone = $1',
            'http.status_code': 200,
          },
        },
      ],
    });
    const json = JSON.stringify(e);
    expect(json).not.toMatch(/9876543210|a@b\.co|User/);
    expect(e.spans[0].data['http.status_code']).toBe(200);
    expect(e.spans[0].description).toBe('GET https://api.resend.com/emails');
  });

  it('redacts Indian mobile numbers in messages, exceptions, breadcrumbs and extra', () => {
    const e: any = scrubEvent({
      message: 'call +91 98765 43210? no: +91-9876543210 or 09876543210 x',
      exception: { values: [{ value: 'bad phone 9876543210' }] },
      breadcrumbs: [
        { message: 'sent to 8765432109', data: { note: 'ring 7654321098' } },
      ],
      extra: { note: 'phone is 6543210987' },
    });
    expect(JSON.stringify(e)).not.toMatch(/987654|876543|765432|654321/);
    expect(redactString('order 1234567890123 total 99')).toBe(
      'order 1234567890123 total 99',
    );
  });

  it('truncates Prisma call arguments at "invocation:" and caps long values', () => {
    const e: any = scrubEvent({
      exception: {
        values: [
          {
            value:
              '\nInvalid `prisma.order.create()` invocation:\n{ data: { name: "Jane Doe", address: "12 Rose Street" } }\nArgument x missing',
          },
          { value: 'x'.repeat(2000) },
        ],
      },
    });
    expect(e.exception.values[0].value).toContain('invocation:');
    expect(e.exception.values[0].value).not.toMatch(/Jane|Rose/);
    expect(e.exception.values[1].value.length).toBeLessThanOrEqual(503);
  });

  it('still redacts emails and keeps non-sensitive text', () => {
    const e: any = scrubEvent({ message: 'fail jane@example.com in checkout' });
    expect(e.message).toBe(`fail ${REDACTED} in checkout`);
  });

  it('only propagates trace headers to the loopback API', () => {
    expect(opts.tracePropagationTargets).toHaveLength(1);
    expect(
      opts.tracePropagationTargets[0].test('http://127.0.0.1:3001/x'),
    ).toBe(true);
    expect(
      opts.tracePropagationTargets[0].test('https://api.razorpay.com/v1'),
    ).toBe(false);
  });

  it('ignoreErrors no longer swallows genuine connection errors', () => {
    const hit = (s: string) => opts.ignoreErrors.some((r: RegExp) => r.test(s));
    expect(hit('Error: aborted')).toBe(true);
    expect(hit('Error: request aborted')).toBe(true);
    expect(hit('Error: read ECONNRESET')).toBe(false);
    expect(hit('Error: transaction aborted by deadlock')).toBe(false);
  });
});
