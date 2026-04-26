import { createHmac, scrypt as scryptCb, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(plain, salt, KEY_LEN);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(plain, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

export interface JwtPayload {
  sub: number;
  email: string;
  role: 'CUSTOMER' | 'ADMIN';
  iat: number;
  exp: number;
}

function getSecret(): string {
  return process.env.JWT_SECRET || 'dev-secret-change-me-in-production';
}

export function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  ttlSeconds = 60 * 60 * 24 * 7,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', getSecret()).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = createHmac('sha256', getSecret()).update(signingInput).digest();
  const provided = base64urlDecode(encodedSig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}
