const PRODUCTION_ORIGINS = ['https://freshpetalsindia.com', 'https://www.freshpetalsindia.com', 'https://admin.freshpetalsindia.com'];
const LOCAL_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3002', 'http://127.0.0.1:3002'];

/**
 * Allowed CORS origins. The three production domains are always allowed; localhost origins only outside
 * production (NODE_ENV=production serves real customers, a page on someone's localhost has no business calling it).
 * CORS_ORIGINS / CORS_ORIGIN (comma separated) are added explicitly by the operator in every environment.
 */
export function buildCorsOrigins(nodeEnv: string | undefined, extra: string | undefined): string[] {
  const extras = (extra ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const base = nodeEnv === 'production' ? PRODUCTION_ORIGINS : [...PRODUCTION_ORIGINS, ...LOCAL_ORIGINS];
  return [...new Set([...base, ...extras])];
}
