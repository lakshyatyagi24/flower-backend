import { buildCorsOrigins } from './cors-origins';

describe('buildCorsOrigins', () => {
  it('production: only the three domains, no localhost', () => {
    expect(buildCorsOrigins('production', undefined)).toEqual([
      'https://freshpetalsindia.com',
      'https://www.freshpetalsindia.com',
      'https://admin.freshpetalsindia.com',
    ]);
  });
  it('non-production adds localhost origins', () => {
    const o = buildCorsOrigins('development', undefined);
    expect(o).toContain('http://localhost:3000');
    expect(o).toContain('https://freshpetalsindia.com');
    expect(buildCorsOrigins(undefined, '')).toContain('http://localhost:3002');
  });
  it('operator extras are trimmed, deduplicated and allowed in production too', () => {
    const o = buildCorsOrigins('production', ' https://staging.example.com , ,https://freshpetalsindia.com');
    expect(o).toContain('https://staging.example.com');
    expect(o.filter((x) => x === 'https://freshpetalsindia.com')).toHaveLength(1);
    expect(o.some((x) => x.includes('localhost'))).toBe(false);
  });
});
