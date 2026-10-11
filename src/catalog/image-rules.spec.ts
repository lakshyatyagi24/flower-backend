import { readFileSync } from 'fs';
import { join } from 'path';
import { InterimManifest, matchKey } from './image-rules';

const manifest: InterimManifest = JSON.parse(
  readFileSync(join(__dirname, '../../prisma/data/interim-images.json'), 'utf8'),
);

describe('matchKey', () => {
  const m = (name: string) => matchKey(name, manifest.rules);

  it('maps tube roses to tuberose, not rose', () => {
    expect(m('Tube Roses "Rajnigandha"')).toBe('tuberose');
    expect(m('tuberose')).toBe('tuberose');
  });

  it('maps plain roses to rose', () => {
    expect(m('Ruby Red Roses')).toBe('rose');
    expect(m('Blush Pink Spray Roses')).toBe('rose');
  });

  it('maps santini chrysanthemum to chrysanthemum', () => {
    expect(m('Orange Santini Chrysanthemum')).toBe('chrysanthemum');
    expect(m('Blazing Yellow Button Chrysanthemums')).toBe('chrysanthemum');
  });

  it('is case-insensitive', () => {
    expect(m('PEARL WHITE ORCHIDS')).toBe('orchid');
    expect(m('oriental LILY')).toBe('lily');
  });

  it('returns null for unknown names', () => {
    expect(m('Heliconia')).toBeNull();
    expect(m('')).toBeNull();
  });
});

describe('interim-images manifest', () => {
  it('has an image entry for every rule key', () => {
    for (const r of manifest.rules) {
      expect(manifest.images[r.key]).toBeDefined();
    }
  });

  it('only uses https images with source and file', () => {
    for (const img of Object.values(manifest.images)) {
      expect(img.file).toMatch(/^https:\/\/(images\.pexels\.com|images\.unsplash\.com)\//);
      expect(img.source).toMatch(/^https:\/\/(www\.pexels\.com|unsplash\.com)\//);
    }
  });
});
