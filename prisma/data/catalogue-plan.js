// Pure planning functions for prisma/apply-catalogue-content.js. No database, no filesystem access (file existence is
// injected), so every rule is unit-tested (src/catalog/catalogue-content.spec.ts).
//
// A "change" is { table, id, key, before: {field: value}, after: {field: value} } where `key` is the slug (for
// logging). `before` holds ONLY the fields that change. The same shape is written to the backup file and used to restore.
//
// Overriding principle (ledger R11): a value the owner may have edited is never overwritten. Each planner states the
// exact condition under which it considers a value "ours to replace".

const PLACEHOLDER_IMAGE = '/images/placeholder-bloom.jpg';

// ---------------------------------------------------------------------------------------------------------------------
// Descriptions

// Fragments that only occur in the competitor-derived text the original seed copied in.
const COMPETITOR_MARKERS = [
  /^\s*what you get\s*$/im,
  /\bflower food\b/i,
  /\bcare card\b/i,
  /\bbrown paper\b/i,
  /^\s*size it right\s*$/im,
  /^\s*know the story\s*$/im,
  /\bpaper cones?\b/i,
  /100% sustainable organi[sz]ation/i,
];

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function isCompetitorCopy(text) {
  if (isBlank(text)) return false;
  return COMPETITOR_MARKERS.some((re) => re.test(String(text)));
}

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * @param products  [{ id, slug, description }]
 * @param opts.copy     { [slug]: { description } }  the new copy
 * @param opts.oldSeed  { [slug]: string }            descriptions the original seed wrote (exact-match = never edited)
 * @param opts.force    overwrite every description that has new copy, even a hand-written one
 * @returns { changes, skipped: [{ slug, reason }], counts }
 *   reasons: 'no-copy', 'already-current', 'live-edited'
 *   reasons of change (in `after`-less `why`): 'competitor-pattern', 'old-seed', 'empty', 'forced'
 */
function planDescriptions(products, opts) {
  const { copy, oldSeed = {}, force = false } = opts;
  const changes = [];
  const skipped = [];
  for (const p of products) {
    const entry = copy[p.slug];
    if (!entry || isBlank(entry.description)) {
      skipped.push({ slug: p.slug, reason: 'no-copy' });
      continue;
    }
    const target = entry.description;
    if (norm(p.description) === norm(target)) {
      skipped.push({ slug: p.slug, reason: 'already-current' });
      continue;
    }
    let why = null;
    if (isBlank(p.description)) why = 'empty';
    else if (isCompetitorCopy(p.description)) why = 'competitor-pattern';
    else if (oldSeed[p.slug] !== undefined && norm(oldSeed[p.slug]) === norm(p.description)) why = 'old-seed';
    else if (force) why = 'forced';
    if (!why) {
      skipped.push({ slug: p.slug, reason: 'live-edited' });
      continue;
    }
    changes.push({ table: 'product', id: p.id, key: p.slug, why, before: { description: p.description ?? null }, after: { description: target } });
  }
  return { changes, skipped, counts: countBy(changes, 'why') };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stock

const DEFAULT_STOCK = 25;

function parseStock(raw) {
  if (raw === undefined) return DEFAULT_STOCK;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw new Error(`--stock must be a whole number from 1 to 100000 (got "${raw}")`);
  return n;
}

/**
 * Default stock ONLY where stock is 0 or null, for active, purchasable products. A product that has ever been ordered and
 * sits at 0 may simply be sold out, so it is left alone and reported.
 * @param products [{ id, slug, stock, active, saleMode }]
 * @param opts.stock      value to set
 * @param opts.orderedIds Set of product ids that appear in at least one order item
 */
function planStock(products, opts = {}) {
  const stock = opts.stock ?? DEFAULT_STOCK;
  const ordered = opts.orderedIds || new Set();
  const changes = [];
  const skipped = [];
  for (const p of products) {
    if (p.active === false) {
      skipped.push({ slug: p.slug, reason: 'inactive' });
    } else if (p.saleMode && p.saleMode !== 'PURCHASE') {
      skipped.push({ slug: p.slug, reason: 'enquiry-only' });
    } else if (p.stock !== null && p.stock !== undefined && p.stock > 0) {
      skipped.push({ slug: p.slug, reason: 'has-stock' });
    } else if (ordered.has(p.id)) {
      skipped.push({ slug: p.slug, reason: 'ordered-before-maybe-sold-out' });
    } else {
      changes.push({ table: 'product', id: p.id, key: p.slug, why: 'zero-stock', before: { stock: p.stock ?? null }, after: { stock } });
    }
  }
  return { changes, skipped, counts: countBy(skipped, 'reason') };
}

// ---------------------------------------------------------------------------------------------------------------------
// Featured

// Variety across flower types, colours and price points. Chosen from products the original seed already featured, so on
// a database that still has the seed defaults this plans no change; it only restores them if they were cleared.
const CURATED_FEATURED = [
  'rose-ruby-red',
  'hydrangea-powder-blue',
  'oriental-lily-pearl-white',
  'lisianthus-blush-pink',
  'mokara-orchids-royal-purple',
  'sunflowers',
  'carnations-hot-pink',
  'tube-roses-rajnigandha',
];

/** Sets featured=true for curated, active products that are not featured. NEVER unsets anything. */
function planFeatured(products, curated = CURATED_FEATURED) {
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const changes = [];
  const skipped = [];
  for (const slug of curated) {
    const p = bySlug.get(slug);
    if (!p) skipped.push({ slug, reason: 'not-in-catalogue' });
    else if (p.active === false) skipped.push({ slug, reason: 'inactive' });
    else if (p.featured) skipped.push({ slug, reason: 'already-featured' });
    else changes.push({ table: 'product', id: p.id, key: slug, why: 'curated', before: { featured: false }, after: { featured: true } });
  }
  return { changes, skipped, existingFeatured: products.filter((p) => p.featured && p.active !== false).length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Categories

const CATEGORY_ORDER = [
  { slug: 'cut-flowers', name: 'Cut Flowers', sortOrder: 1 },
  { slug: 'plants', name: 'Plants', sortOrder: 2 },
  { slug: 'corporate-bouquets', name: 'Corporate Bouquets', sortOrder: 3 },
  { slug: 'arrangements', name: 'Arrangements', sortOrder: 4 },
  { slug: 'hampers', name: 'Hampers', sortOrder: 5 },
];

const squash = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * Proposes sort-order and name tidying for the five known categories without touching deliberate admin choices:
 *  - sortOrder is proposed only when the known categories have never been ordered (all share one value, e.g. all 0) or
 *    two of them collide; an order that is merely different from ours is the owner's choice and is left alone.
 *  - name is proposed only when it differs from the expected name by whitespace or letter case alone, or is blank.
 * Also returns observations (not changes): active categories with no products.
 * @param categories [{ id, slug, name, sortOrder, active, productCount }]
 */
function planCategories(categories) {
  const known = categories.filter((c) => CATEGORY_ORDER.some((k) => k.slug === c.slug));
  const orders = known.map((c) => c.sortOrder ?? 0);
  const allSame = known.length > 1 && new Set(orders).size === 1;
  const collide = new Set(orders).size !== orders.length;
  const reorder = allSame || collide;

  const changes = [];
  for (const c of known) {
    const want = CATEGORY_ORDER.find((k) => k.slug === c.slug);
    const before = {};
    const after = {};
    if (reorder && c.sortOrder !== want.sortOrder) {
      before.sortOrder = c.sortOrder;
      after.sortOrder = want.sortOrder;
    }
    const name = squash(c.name);
    if (name === '' || (c.name !== want.name && name.toLowerCase() === want.name.toLowerCase())) {
      before.name = c.name;
      after.name = want.name;
    }
    if (Object.keys(after).length) changes.push({ table: 'category', id: c.id, key: c.slug, why: 'tidy', before, after });
  }
  const observations = [];
  for (const c of categories) {
    if (c.active !== false && c.productCount === 0) {
      observations.push(`category "${c.name}" (${c.slug}) is active but has no products; the storefront hides empty categories from navigation`);
    }
  }
  return { changes, observations };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sliders

/**
 * Creates the draft slides only when the table is empty. A slide whose image file is missing is created INACTIVE (never an
 * active slide pointing at nothing). Pass `fileExists(publicPath) -> boolean`.
 */
function planSliders(existingCount, slides, rowBuilder, fileExists) {
  if (existingCount > 0) return { creates: [], skippedReason: `slider table already has ${existingCount} row(s); nothing created` };
  const creates = slides.map((s) => {
    const present = !!fileExists(s.image);
    return { row: rowBuilder(s, present), imagePresent: present };
  });
  return { creates, skippedReason: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Product images

const LOCAL_IMAGE = /^\/images\/products\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.(?:webp|jpe?g|png|avif)$/i;

/**
 * Mapping file format (prisma/data/product-images.json):
 * {
 *   "version": 1,
 *   "items":  { "<product-slug>": { "image": "/images/products/<file>.webp", "alt": "optional text" } },
 *   "groups": [ { "slugPrefix": "rose-", "image": "/images/products/roses.webp", "alt": "optional" } ]
 * }
 * `items` win over `groups`; the first matching group wins. One photo may serve many products (colour variants).
 * `alt` is documentation for the owner: the Product table has no alt field and the storefront uses the product name.
 * Returns a list of error strings (empty = valid).
 */
function validateImageMap(map) {
  const errors = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ['mapping must be a JSON object'];
  if (map.version !== 1) errors.push('"version" must be 1');
  const items = map.items ?? {};
  const groups = map.groups ?? [];
  if (typeof items !== 'object' || Array.isArray(items)) errors.push('"items" must be an object keyed by product slug');
  if (!Array.isArray(groups)) errors.push('"groups" must be an array');
  const check = (where, e) => {
    if (!e || typeof e !== 'object') return errors.push(`${where}: must be an object`);
    if (typeof e.image !== 'string' || !LOCAL_IMAGE.test(e.image) || e.image.includes('..')) {
      errors.push(`${where}: image must be a path like /images/products/<name>.webp (webp, jpg, png or avif), got ${JSON.stringify(e.image)}`);
    }
    if (e.alt !== undefined && (typeof e.alt !== 'string' || e.alt.length > 200)) errors.push(`${where}: alt must be a string of at most 200 characters`);
  };
  if (typeof items === 'object' && !Array.isArray(items)) {
    for (const [slug, e] of Object.entries(items)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.push(`items["${slug}"]: slug must be lowercase letters, digits and hyphens`);
      check(`items["${slug}"]`, e);
    }
  }
  if (Array.isArray(groups)) {
    groups.forEach((g, i) => {
      if (!g || typeof g.slugPrefix !== 'string' || g.slugPrefix.length < 2 || !/^[a-z0-9-]+$/.test(g.slugPrefix)) {
        errors.push(`groups[${i}]: slugPrefix must be 2+ characters of lowercase letters, digits and hyphens`);
      }
      check(`groups[${i}]`, g);
    });
  }
  return errors;
}

/** The mapped image for a slug (exact item first, then the first matching group), or null. */
function resolveImage(map, slug) {
  const item = map.items && map.items[slug];
  if (item) return item.image;
  for (const g of map.groups || []) if (slug.startsWith(g.slugPrefix)) return g.image;
  return null;
}

/**
 * Whether the current value of Product.image may be replaced by a mapped local photo:
 *   empty, the storefront placeholder, or a hotlink to the competitor's Shopify CDN / theflora.in.
 * NEVER a Cloudinary image or any other owner-supplied URL. Previously mapped local photos (/images/products/...) are
 * replaced only with `force` (to swap in better photos), still never Cloudinary.
 */
function isReplaceableImage(current, { force = false } = {}) {
  if (isBlank(current)) return true;
  const v = String(current).trim();
  if (v === PLACEHOLDER_IMAGE) return true;
  if (/^(?:https?:)?\/\/(?:[^/]*\.)?(?:cdn\.shopify\.com|theflora\.in)(?:[/:]|$)/i.test(v) || /^cdn\.shopify\.com\//i.test(v)) return true;
  if (force && v.startsWith('/images/products/')) return true;
  return false;
}

/**
 * @param products [{ id, slug, image }]
 * @param map      validated mapping
 * @param opts.fileExists (publicPath) => boolean   a mapped photo whose file is missing is skipped, never written
 */
function planImages(products, map, opts) {
  const { fileExists, force = false } = opts;
  const changes = [];
  const skipped = [];
  for (const p of products) {
    const target = resolveImage(map, p.slug);
    if (!target) {
      skipped.push({ slug: p.slug, reason: 'unmapped' });
    } else if (p.image === target) {
      skipped.push({ slug: p.slug, reason: 'already-current' });
    } else if (!isReplaceableImage(p.image, { force })) {
      skipped.push({ slug: p.slug, reason: 'has-own-image' });
    } else if (!fileExists(target)) {
      skipped.push({ slug: p.slug, reason: 'file-missing' });
    } else {
      changes.push({ table: 'product', id: p.id, key: p.slug, why: 'image', before: { image: p.image ?? null }, after: { image: target } });
    }
  }
  return { changes, skipped, counts: countBy(skipped, 'reason') };
}

// ---------------------------------------------------------------------------------------------------------------------
// Restore

/**
 * Decide, row by row, whether a backup entry can be reverted: only fields whose CURRENT value still equals what the
 * apply wrote (`after`) are reverted, so edits made since are never clobbered (unless `force`).
 * @param backup  { changes: [...], createdSliders: [{id, after}] }
 * @param current { product: Map(id->row), category: Map(id->row), slider: Map(id->row) }
 */
function planRestore(backup, current, { force = false } = {}) {
  const updates = [];
  const conflicts = [];
  for (const c of backup.changes || []) {
    const row = current[c.table] && current[c.table].get(c.id);
    if (!row) {
      conflicts.push({ table: c.table, key: c.key, reason: 'row-missing' });
      continue;
    }
    const data = {};
    for (const f of Object.keys(c.after)) {
      if (force || sameValue(row[f], c.after[f])) data[f] = c.before[f];
      else conflicts.push({ table: c.table, key: c.key, reason: `${f}-changed-since-apply` });
    }
    if (Object.keys(data).length) updates.push({ table: c.table, id: c.id, key: c.key, data });
  }
  const deletes = [];
  for (const s of backup.createdSliders || []) {
    const row = current.slider && current.slider.get(s.id);
    if (!row) continue;
    if (force || (row.title === s.after.title && row.image === s.after.image && row.href === s.after.href && row.active === s.after.active)) {
      deletes.push({ id: s.id, title: row.title });
    } else {
      conflicts.push({ table: 'slider', key: String(s.id), reason: 'edited-since-apply' });
    }
  }
  return { updates, deletes, conflicts };
}

function sameValue(a, b) {
  return (a ?? null) === (b ?? null);
}

// ---------------------------------------------------------------------------------------------------------------------

function countBy(list, field) {
  const out = {};
  for (const x of list) out[x[field]] = (out[x[field]] || 0) + 1;
  return out;
}

/** Short, single-line rendering of a value for the diff summary (never prints a whole description). */
function brief(v, max = 48) {
  if (v === null || v === undefined) return '(empty)';
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

module.exports = {
  PLACEHOLDER_IMAGE,
  COMPETITOR_MARKERS,
  DEFAULT_STOCK,
  CURATED_FEATURED,
  CATEGORY_ORDER,
  isCompetitorCopy,
  planDescriptions,
  parseStock,
  planStock,
  planFeatured,
  planCategories,
  planSliders,
  validateImageMap,
  resolveImage,
  isReplaceableImage,
  planImages,
  planRestore,
  brief,
};
