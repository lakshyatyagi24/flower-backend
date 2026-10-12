// Seed taxonomy: default category descriptions and occasion tags for products.
//
// Everything here is applied NON-DESTRUCTIVELY by prisma/seed.js: a value is only written when the
// existing one is empty, so admin edits are never overwritten and re-running the seed is a no-op.
// Copy is a DRAFT for the owner to review (no delivery-time, price or award claims on purpose).

/** Occasion slugs; these are the Product.tags values the storefront's /occasions/<slug> pages filter on. */
const OCCASION_TAGS = [
  'birthday',
  'anniversary',
  'wedding',
  'corporate',
  'sympathy',
  'congratulations',
  'get-well-soon',
  'just-because',
];

// First match wins, so the most specific rules come first (tuberose before rose, orchid before others).
// `match` runs against "<name> <slug>" lower-cased with separators turned into spaces.
const TAG_RULES = [
  { key: 'foliage', match: /foliage|filler|\bferns?\b|eucalyptus|ruscus|gypsophila|baby's breath|leatherleaf|salal|asparagus/, tags: [] },
  { key: 'tuberose', match: /tuberose|tube rose|rajnigandha|polianthes/, tags: ['wedding', 'sympathy', 'anniversary'] },
  { key: 'orchid', match: /orchid|dendrobium|mokara|phalaenopsis|cymbidium/, tags: ['corporate', 'congratulations', 'anniversary'] },
  { key: 'anthurium', match: /anthurium/, tags: ['corporate', 'congratulations', 'anniversary'] },
  { key: 'lisianthus', match: /lisianthus/, tags: ['wedding', 'anniversary', 'congratulations'] },
  { key: 'gladioli', match: /gladiol/, tags: ['congratulations', 'corporate', 'sympathy'] },
  { key: 'liatris', match: /liatris/, tags: ['just-because', 'birthday'] },
  { key: 'hydrangea', match: /hydrangea/, tags: ['wedding', 'anniversary', 'just-because'] },
  { key: 'lily', match: /\blil(y|ies)\b/, tags: ['sympathy', 'congratulations', 'wedding'] },
  { key: 'sunflower', match: /sunflower|helianthus/, tags: ['get-well-soon', 'birthday', 'just-because'] },
  // chrysanthemum covers button, disbud and santini; "helichrysum" is a different flower and does not match.
  { key: 'chrysanthemum', match: /chrysanthemum|santini|\bmums?\b/, tags: ['sympathy', 'corporate', 'get-well-soon'] },
  { key: 'carnation', match: /carnation|dianthus/, tags: ['birthday', 'just-because', 'get-well-soon'] },
  { key: 'gerbera', match: /gerbera/, tags: ['birthday', 'get-well-soon', 'congratulations'] },
  { key: 'tulip', match: /tulip/, tags: ['anniversary', 'just-because', 'birthday'] },
  { key: 'rose', match: /\broses?\b/, tags: ['anniversary', 'just-because', 'wedding'] },
  { key: 'alstroemeria', match: /alstroemeria/, tags: ['birthday', 'congratulations', 'just-because'] },
  { key: 'agapanthus', match: /agapanthus/, tags: ['wedding', 'congratulations'] },
  { key: 'snapdragon', match: /snapdragon|antirrhinum/, tags: ['congratulations', 'get-well-soon'] },
  { key: 'helichrysum', match: /helichrys/, tags: ['birthday', 'just-because'] },
  { key: 'heliconia', match: /heliconia/, tags: ['corporate', 'congratulations'] },
  { key: 'assorted', match: /assorted|mixed/, tags: ['birthday', 'just-because', 'get-well-soon'] },
];

/** Occasion tags for a product ({ name, slug }); [] for foliage, fillers and anything unrecognised. */
function tagsForProduct(product) {
  const text = `${product.name || ''} ${product.slug || ''}`.toLowerCase().replace(/[-_]+/g, ' ');
  const rule = TAG_RULES.find((r) => r.match.test(text));
  return rule ? [...rule.tags] : [];
}

const categoryDescriptions = {
  'cut-flowers':
    'Choose cut flowers by the bunch, from roses, lilies and chrysanthemums to orchids, carnations and hydrangea. ' +
    'Each variety is available in its own colours, so you can keep a vase to one clean shade or mix several for texture and depth. ' +
    'Trim the stems at an angle, strip any leaves that would sit below the waterline and change the water every couple of days ' +
    'to help the blooms last. Hand-selected stems are a good starting point for your own arrangement, gift or event.',
  plants:
    'Indoor and outdoor plants for homes, balconies and workspaces. A potted plant is a gift that keeps growing, ' +
    'and a good choice when cut flowers feel too short-lived. Check the light and watering notes on each product, ' +
    'and match the plant to the spot it will live in: bright, indirect light suits most indoor foliage, ' +
    'while hardy flowering plants prefer a sunny balcony. Plants are added to the collection as they become available.',
  'corporate-bouquets':
    'Bouquets for offices, conferences, product launches and client gifting across Delhi NCR. ' +
    'These are made to order in bulk, so tell us the quantity, budget, colour palette and date and we will send a quote. ' +
    'Structured, upright designs in white, green and a single accent colour tend to suit a professional setting, ' +
    'and orchids, lilies and chrysanthemums hold their shape well through a long event. Add your company message on a card.',
  arrangements:
    'Custom-built floral arrangements for events, tables, entrances and gifts. Each one is designed around your brief, ' +
    'so share the occasion, the colours you like and where the arrangement will sit and we will propose a design and price. ' +
    'Compact table pieces suit dining and reception areas, while taller designs work for entrances and stages. ' +
    'Roses, lilies, hydrangea and lisianthus are popular bases because they are full and photograph well.',
  hampers:
    'Gift hampers that combine flowers, plants and thoughtful extras in one package. They are put together to order, ' +
    'so tell us who the gift is for, the occasion and your budget and we will suggest a combination. ' +
    'A small hamper with a bouquet and a handwritten card suits a birthday or a thank-you, while a larger selection ' +
    'works for festivals, weddings and corporate gifting. Enquire with your preferences and we will take it from there.',
};

/**
 * Descriptions earlier versions of the seed wrote. If a category still holds one of these verbatim the admin
 * never edited it, so it is safe to replace with the editorial default. Anything else is left alone.
 */
const LEGACY_CATEGORY_DESCRIPTIONS = [
  'Farm-fresh cut flowers sourced daily from the mandi. Bulk and corporate-friendly pricing.',
  'Indoor and outdoor plants. Real photos to be uploaded by the store admin.',
  'Bulk bouquet orders for corporate events, conferences, and gifting. Enquire for a custom quote.',
  'Custom-built floral arrangements for events and gifting. Enquire with your preferences.',
  'Curated gift hampers with flowers, plants, and accents. Enquire for a custom build.',
];

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

/** True when the category description may be set by the seed (empty, or an untouched legacy placeholder). */
function shouldSetDescription(current) {
  return isBlank(current) || LEGACY_CATEGORY_DESCRIPTIONS.includes(String(current).trim());
}

/**
 * Applies the defaults. Returns counts of what changed so the seed can log them and prove idempotence.
 * Never touches a category that has an admin-written description, nor a product that already has tags.
 */
async function applyTaxonomy(prisma) {
  let descriptions = 0;
  for (const [slug, description] of Object.entries(categoryDescriptions)) {
    const cat = await prisma.category.findUnique({ where: { slug }, select: { id: true, description: true } });
    if (!cat || !shouldSetDescription(cat.description) || cat.description === description) continue;
    await prisma.category.update({ where: { id: cat.id }, data: { description } });
    descriptions += 1;
  }

  const perTag = Object.fromEntries(OCCASION_TAGS.map((t) => [t, 0]));
  let tagged = 0;
  const products = await prisma.product.findMany({ select: { id: true, name: true, slug: true, tags: true } });
  for (const p of products) {
    if (p.tags && p.tags.length > 0) continue;
    const tags = tagsForProduct(p);
    if (tags.length === 0) continue;
    await prisma.product.update({ where: { id: p.id }, data: { tags } });
    tagged += 1;
    for (const t of tags) perTag[t] += 1;
  }
  return { descriptions, tagged, perTag };
}

module.exports = {
  OCCASION_TAGS,
  TAG_RULES,
  tagsForProduct,
  categoryDescriptions,
  LEGACY_CATEGORY_DESCRIPTIONS,
  isBlank,
  shouldSetDescription,
  applyTaxonomy,
};
