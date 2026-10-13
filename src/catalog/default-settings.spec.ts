// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DEFAULT_SETTINGS } = require('../../prisma/data/default-settings');
import * as fs from 'fs';
import * as path from 'path';

describe('seed DEFAULT_SETTINGS', () => {
  it('leaves contact email and address blank (no placeholders on fresh DBs)', () => {
    expect(DEFAULT_SETTINGS['store.email']).toBe('');
    expect(DEFAULT_SETTINGS['store.address']).toBe('');
  });

  it('contains no placeholder text in any value', () => {
    const all = Object.values(DEFAULT_SETTINGS).join(' ').toLowerCase();
    expect(all).not.toContain('example.com');
    expect(all).not.toContain('please update');
  });

  it('keeps the shipping defaults', () => {
    expect(DEFAULT_SETTINGS['shipping.flatRate']).toBe('99');
    expect(DEFAULT_SETTINGS['shipping.freeThreshold']).toBe('1499');
  });

  it('seed.js upserts with an empty update so live rows are never overwritten', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../prisma/seed.js'), 'utf8');
    expect(src).toMatch(/DEFAULT_SETTINGS/);
    expect(src).toMatch(/update:\s*\{\s*\}/);
    expect(src).not.toContain('orders@example.com');
  });
});
