// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isShopifyUrl, pickImageSrc, transformSnapshot, cutFlowerProducts, cutFlowerCategory } =
  require('../../prisma/data/cut-flowers');

describe('cut-flowers catalogue images', () => {
  const product = (src: string) => ({ images: [{ src }] });

  it('emits null for a Shopify CDN image', () => {
    expect(pickImageSrc(product('https://cdn.shopify.com/s/files/1/x/y.jpg?v=1'), null)).toBeNull();
    expect(pickImageSrc(product('//cdn.shopify.com/s/files/1/x/y.jpg'), null)).toBeNull();
  });

  it('passes through non-Shopify https URLs', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/a.jpg';
    expect(pickImageSrc(product(url), null)).toBe(url);
  });

  it('isShopifyUrl detects only cdn.shopify.com', () => {
    expect(isShopifyUrl('https://cdn.shopify.com/a.jpg')).toBe(true);
    expect(isShopifyUrl('https://example.com/a.jpg')).toBe(false);
    expect(isShopifyUrl(null)).toBe(false);
  });

  it('seeded catalogue and category contain no Shopify hotlinks', () => {
    for (const p of cutFlowerProducts) expect(isShopifyUrl(p.image)).toBe(false);
    expect(cutFlowerCategory.image).toBeNull();
    expect(typeof transformSnapshot).toBe('function');
  });
});
