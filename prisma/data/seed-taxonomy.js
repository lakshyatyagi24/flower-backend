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
  { key: 'chrysanthemum', match: /chrysanthemum|santini|\bmums?\b/, tags: ['sympathy', 'corporate'] },
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

// Sympathy flowers follow local custom: white / cream / ivory only. A name qualifies when it says so and
// does not also name a vivid colour ("Pink and White" does not); tuberose (rajnigandha) is always white.
const PALE = /\b(white|cream|ivory|pearl)\b/i;
const VIVID = /\b(red|ruby|pink|blush|yellow|orange|purple|violet|mauve|peach|blue|green|bi-?colou?r)\b/i;

function qualifiesForSympathy(rule, name) {
  if (rule.key === 'tuberose') return true;
  return PALE.test(name) && !VIVID.test(name);
}

/** Occasion tags for a product ({ name, slug }); [] for foliage, fillers and anything unrecognised. */
function tagsForProduct(product) {
  const name = String(product.name || '');
  const text = `${name} ${product.slug || ''}`.toLowerCase().replace(/[-_]+/g, ' ');
  const rule = TAG_RULES.find((r) => r.match.test(text));
  if (!rule) return [];
  return rule.tags.filter((t) => t !== 'sympathy' || qualifiesForSympathy(rule, name));
}

const categoryDescriptions = {
  'cut-flowers':
    'Cut flowers sold by the bunch: roses, lilies, chrysanthemums, orchids, carnations, hydrangea and more, each in its own range of colours. ' +
    'Keep a vase to a single shade for a clean look, or combine two or three varieties for contrast in shape and texture. ' +
    'At home, cut the stems on a slant, remove any leaves below the waterline and use a clean vase. ' +
    'Browse by flower and colour, then add your own foliage or fillers to build an arrangement that suits the room.',
  plants:
    'Indoor and outdoor plants for homes, balconies and workspaces. A potted plant suits someone who would rather keep a gift than watch it fade, ' +
    'and it sits easily on a desk or windowsill. Read the light and watering notes on each product and match the plant to its spot: ' +
    'bright, indirect light suits most indoor foliage, while flowering plants usually want direct sun. ' +
    'New plants are added to this collection as they are listed.',
  'corporate-bouquets':
    'Bouquets for offices, conferences, product launches and client gifts in Delhi NCR, arranged to a brief. ' +
    'Send an enquiry with the quantity, colour palette, budget and date and we will reply with a quote. ' +
    'Upright, structured designs in white, green and one accent colour suit a professional setting, ' +
    'and orchids, lilies and chrysanthemums keep their shape through a long event. A printed or handwritten message can go with each bouquet.',
  arrangements:
    'Floral arrangements designed to a brief for events, tables, entrances and gifts. ' +
    'Share the occasion, the colours you like and where the piece will sit, and we will propose a design and a price after your enquiry. ' +
    'Low, compact pieces suit dining tables and reception desks, while taller designs work for entrances and stages. ' +
    'Roses, lilies, hydrangea and lisianthus are common bases because their full heads fill space quickly.',
  hampers:
    'Gift hampers that pair flowers or plants with extras, put together from your enquiry. ' +
    'Tell us who the gift is for, the occasion and your budget, and we will suggest a combination. ' +
    'A small hamper with a bouquet and a card suits a birthday or a thank-you, while a larger selection fits festivals, weddings and corporate gifting. ' +
    'Each hamper is assembled around your brief, so contents and quantities can be adjusted.',
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
  // Only the seeded cut-flower catalogue is auto-tagged; a hamper or plant is never guessed from its name.
  // Empty tags mean "untagged", so a cut flower whose tags an admin cleared is tagged again.
  const products = await prisma.product.findMany({
    select: { id: true, name: true, slug: true, tags: true, category: { select: { slug: true } } },
  });
  for (const p of products) {
    if (!p.category || p.category.slug !== 'cut-flowers') continue;
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
