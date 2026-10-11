import * as express from 'express';
import * as request from 'supertest';
import { parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it.each([undefined, '', '0', 'abc', '-1', '1.5'])('%p -> null', (v) => {
    expect(parseTrustProxy(v as any)).toBeNull();
  });
  it('2 -> 2', () => expect(parseTrustProxy('2')).toBe(2));
});

describe('express req.ip with trust proxy', () => {
  const ipOf = async (trust: number | null) => {
    const app = express();
    if (trust) app.set('trust proxy', trust);
    app.get('/', (req, res) => res.send(req.ip));
    // Caddy appends client ip, nginx appends caddy's ip; socket peer is nginx (127.0.0.1)
    const res = await request(app).get('/').set('X-Forwarded-For', '203.0.113.9, 10.0.0.2');
    return res.text;
  };
  it('without trust proxy req.ip is the socket peer (shared bucket)', async () => {
    expect(await ipOf(null)).toMatch(/127\.0\.0\.1|::1/);
  });
  it('with trust proxy 2 req.ip is the real client', async () => {
    expect(await ipOf(2)).toBe('203.0.113.9');
  });
});
