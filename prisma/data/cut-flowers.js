// Cut-flower catalogue migrated from theflora.in.
//
// The raw Shopify products.json snapshot lives in
// `prisma/data/theflora-snapshot.json`. This module transforms that snapshot
// into rows for our flat Product table:
//
//   * Single-variant products  -> 1 DB product
//   * Color + Size variants    -> 1 DB product per color (uses the smallest
//                                 size variant for price + image, since our
//                                 storefront has no variant picker)
//   * Size-only variants       -> 1 DB product (smallest size)
//
// To refresh the snapshot when theflora.in changes:
//   curl -s "https://theflora.in/collections/cut-flowers/products.json?limit=50" \
//     -A "Mozilla/5.0" -o prisma/data/theflora-snapshot.json
//
// `seedCutFlowers(prisma)` is idempotent: existing rows (matched by slug)
// have merchandising fields refreshed but their stock count is preserved so
// it does not overwrite an admin's manual count.

const path = require('path');

const SNAPSHOT_PATH = path.join(__dirname, 'theflora-snapshot.json');

// Handles in the snapshot that we don't want as cut-flower products.
// "handmade-card-..." is an add-on, not a flower.
const SKIP_HANDLES = new Set(['handmade-card-with-message-bangalore-1']);

// Slug overrides — clean up Shopify's internal "copy-of" / "-bunch-of-N"
// handles into something readable on our storefront.
const SLUG_OVERRIDES = {
  'copy-of-festive-glory': 'spray-roses',
  'anthuriums-bunch-of-6': 'anthuriums',
  'spray-carnations-bunch-of-12': 'spray-carnations',
  'button-chrysanthemums-bunch-of-12': 'button-chrysanthemums',
  'gladioli-bunch-of-12': 'gladioli',
  'button-chrysanthemums-copy': 'santini-chrysanthemums',
  'sunflower-bio-colour': 'sunflowers-bicolor',
  'tube-roses-rajnigandha': 'tube-roses-rajnigandha',
  'orchids': 'dendrobium-orchids',
};

// Hand-picked entries to surface in the homepage's Featured rail.
// For multi-color products we feature exactly one color so the rail isn't
// dominated by, say, every shade of rose.
const FEATURED_SINGLES = new Set([
  'jumilla-roses',
  'tube-roses-rajnigandha',
  'sunflowers',
  'sunflowers-bicolor',
  'liatris',
  'assorted-bunch-of-cut-flowers',
]);
const FEATURED_BY_HANDLE_COLOR = new Map([
  ['rose', 'Ruby Red'],
  ['oriental-lily', 'Pearl White'],
  ['mokara-orchids', 'Royal Purple'],
  ['hydrangea', 'Powder Blue'],
  ['anthuriums-bunch-of-6', 'Ruby Red'],
  ['lisianthus', 'Blush Pink'],
  ['carnations', 'Hot Pink'],
]);

const cutFlowerCategory = {
  name: 'Cut Flowers',
  slug: 'cut-flowers',
  image: 'https://cdn.shopify.com/s/files/1/0047/4637/9362/files/IMG_4116-3.jpg?v=1697649468',
};

function slugify(input) {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}

function buildDescription(rawHtml) {
  const text = stripHtml(rawHtml);
  if (!text) return null;
  // Drop the sustainability disclaimer paragraph that appears on most products.
  const filtered = text
    .split('\n')
    .filter((line) => !/100% sustainable organization/i.test(line))
    .join('\n')
    .trim();
  // Cap length to keep cards/PDPs readable.
  if (filtered.length <= 700) return filtered;
  const cut = filtered.slice(0, 700);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return (lastBreak > 300 ? cut.slice(0, lastBreak + 1) : cut).trim();
}

// Parse "Mini (18 stems)" -> 18; "Bunch of 8 stems" -> 8; otherwise null.
function stemsFromVariantTitle(title) {
  if (!title) return null;
  const m = String(title).match(/(\d+)\s*stems?/i);
  return m ? parseInt(m[1], 10) : null;
}

function findOptionIndex(options, name) {
  if (!Array.isArray(options)) return -1;
  return options.findIndex((o) => String(o.name).toLowerCase() === name.toLowerCase());
}

// Group variants by the value at `optionIndex`. For each group, return the
// variant with the smallest price (typically the "Mini" pack on theflora.in).
function smallestVariantByOption(variants, optionIndex) {
  const groups = new Map();
  for (const v of variants) {
    const key = v[`option${optionIndex + 1}`];
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  const out = [];
  for (const [key, group] of groups) {
    const cheapest = group.reduce((acc, v) =>
      parseFloat(v.price) < parseFloat(acc.price) ? v : acc,
    );
    out.push({ key, variant: cheapest, allInGroup: group });
  }
  return out;
}

function pickImageSrc(product, variant) {
  if (variant && variant.featured_image && variant.featured_image.src) {
    return variant.featured_image.src;
  }
  if (Array.isArray(product.images) && product.images[0] && product.images[0].src) {
    return product.images[0].src;
  }
  return null;
}

function productNameWithColor(productTitle, color) {
  // Strip any Shopify suffixes from the title.
  const cleanTitle = productTitle.replace(/\s*\/\/.*$/, '').trim();
  return `${color} ${cleanTitle}`;
}

function transformSnapshot(snapshot) {
  const products = [];

  for (const sp of snapshot.products) {
    if (SKIP_HANDLES.has(sp.handle)) continue;
    const baseSlug = SLUG_OVERRIDES[sp.handle] || sp.handle;
    const description = buildDescription(sp.body_html);
    const cleanTitle = sp.title.replace(/\s*\/\/.*$/, '').trim();

    const colorIdx = findOptionIndex(sp.options, 'Color');
    const sizeIdx = findOptionIndex(sp.options, 'Size');

    if (colorIdx >= 0) {
      // One DB row per color, using the cheapest (smallest pack) variant.
      const featuredColor = FEATURED_BY_HANDLE_COLOR.get(sp.handle);
      for (const { key: color, variant } of smallestVariantByOption(sp.variants, colorIdx)) {
        const stems = stemsFromVariantTitle(variant.title);
        const sizeNote = stems ? ` Bunch of ${stems} stems.` : '';
        products.push({
          slug: `${baseSlug}-${slugify(color)}`,
          name: productNameWithColor(cleanTitle, color),
          description: description ? `${description}${sizeNote}` : null,
          price: parseFloat(variant.price),
          stock: 25,
          featured: featuredColor === color,
          image: pickImageSrc(sp, variant),
        });
      }
      continue;
    }

    // No Color option — single product. Pick the cheapest (smallest size) variant.
    const cheapest = sp.variants.reduce((acc, v) =>
      parseFloat(v.price) < parseFloat(acc.price) ? v : acc,
    );
    const stems = stemsFromVariantTitle(cheapest.title);
    const sizeNote = stems ? ` Bunch of ${stems} stems.` : '';
    products.push({
      slug: baseSlug,
      name: cleanTitle,
      description: description ? `${description}${sizeNote}` : null,
      price: parseFloat(cheapest.price),
      stock: 25,
      featured: FEATURED_SINGLES.has(sp.handle),
      image: pickImageSrc(sp, cheapest),
    });
  }

  // Defensive: drop any product missing required fields.
  return products.filter((p) => p.slug && p.name && Number.isFinite(p.price));
}

function loadSnapshot() {
  return require(SNAPSHOT_PATH);
}

const cutFlowerProducts = transformSnapshot(loadSnapshot());

async function seedCutFlowers(prisma) {
  await prisma.category.upsert({
    where: { slug: cutFlowerCategory.slug },
    create: cutFlowerCategory,
    update: { name: cutFlowerCategory.name, image: cutFlowerCategory.image },
  });
  const category = await prisma.category.findUnique({ where: { slug: cutFlowerCategory.slug } });

  for (const p of cutFlowerProducts) {
    const data = {
      slug: p.slug,
      name: p.name,
      description: p.description,
      price: p.price,
      stock: p.stock,
      featured: p.featured,
      active: true,
      image: p.image,
      categoryId: category.id,
    };
    await prisma.product.upsert({
      where: { slug: p.slug },
      create: data,
      update: {
        name: data.name,
        description: data.description,
        price: data.price,
        featured: data.featured,
        image: data.image,
        categoryId: data.categoryId,
        // intentionally NOT updating stock — preserve whatever the admin has set.
      },
    });
  }
  return { category, count: cutFlowerProducts.length };
}

module.exports = {
  cutFlowerCategory,
  cutFlowerProducts,
  seedCutFlowers,
  // exported for unit/manual inspection
  transformSnapshot,
};
