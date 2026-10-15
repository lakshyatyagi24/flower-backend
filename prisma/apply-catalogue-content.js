// Owner/controller-run: replace the competitor-derived catalogue content with original copy and sensible defaults.
//
// SAFE BY DEFAULT: with no --apply it only PREVIEWS and changes nothing. All planning rules live in
// data/catalogue-plan.js (unit tested); this file only reads rows, prints, backs up, and writes.
//
//   cd /app/backend            (in the container; or flower-backend/ locally with DATABASE_URL set)
//   node prisma/apply-catalogue-content.js                       # preview
//   node prisma/apply-catalogue-content.js --apply               # apply (writes a backup file first)
//   node prisma/apply-catalogue-content.js --restore <backup>    # preview of an undo
//   node prisma/apply-catalogue-content.js --restore <backup> --apply
//
// DEFAULT SECTIONS (all non-destructive):
//   descriptions  new original copy (data/product-copy.js, a DRAFT for owner review) replaces a description ONLY when the
//                 current one is empty, matches the competitor text, or equals the old seed value. A description the owner
//                 edited is never touched (unless --force-descriptions).
//   stock         products with stock 0/null get a DEFAULT of 25 (--stock=N). These are placeholders, NOT real inventory:
//                 the owner must enter real counts in Admin > Products. Products that were ever ordered and sit at 0 are
//                 skipped (they may really be sold out). Checkout needs stock >= quantity, so 0 means "cannot be ordered".
//   featured      a curated set of ~8 is switched ON if off. Nothing is ever switched off.
//   categories    sort order / name tidy-ups, proposed only for clear problems (all unordered, ties, case/space typos).
// OPT-IN SECTIONS:
//   --sliders     create the 3 draft home slides (data/seed-sliders.js) ONLY if the Slider table is empty; slides whose image
//                 file is not in the storefront public/ folder are created INACTIVE.
//   --images      set product photos from data/product-images.json ONLY where the image is empty / placeholder / a
//                 theflora or Shopify hotlink (never Cloudinary or any owner image); a missing file is skipped.
// OTHER FLAGS:
//   --skip=descriptions,stock,featured,categories   leave sections out
//   --backup <file>      where the JSON backup goes (default: $TMPDIR/catalogue-content-backup-<time>.json, mode 0600)
//   --public-dir <dir>   storefront public/ folder (default: ../frontend/public in the image, else the sibling repo)
//   --map <file>         image mapping file (default data/product-images.json)
//   --force-descriptions overwrite hand-edited descriptions too   --force-images also replace earlier /images/products photos
//   --force              (restore) revert fields even if they were edited after the apply
//   --verbose            list every changed row (default: counts and the first few examples)
//
// The backup file lives where you put it. In the container only /tmp is writable and it is lost when the container is
// recreated: copy it out first:  docker compose cp app:/tmp/<file> ./   (see docs/catalogue-content-runbook.md).
const fs = require('fs');
const os = require('os');
const path = require('path');
const plan = require('./data/catalogue-plan');

const VALUE_FLAGS = new Set(['--restore', '--backup', '--stock', '--public-dir', '--map', '--skip']);
const BOOL_FLAGS = new Set(['--apply', '--force-descriptions', '--force-images', '--force', '--sliders', '--images', '--verbose', '--help']);
const SECTIONS = ['descriptions', 'stock', 'featured', 'categories'];

/** Parses `--flag`, `--flag value` and `--flag=value`. Throws on unknown flags or a missing value. */
function parseArgs(argv) {
  const out = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    let a = argv[i];
    let inline;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (BOOL_FLAGS.has(a)) {
      if (inline !== undefined) throw new Error(`${a} takes no value`);
      out.flags.add(a);
    } else if (VALUE_FLAGS.has(a)) {
      const v = inline !== undefined ? inline : argv[++i];
      if (v === undefined || v === '' || (inline === undefined && v.startsWith('--'))) throw new Error(`${a} needs a value`);
      out.values[a] = v;
    } else {
      throw new Error(`unknown argument "${argv[i]}" (try --help)`);
    }
  }
  const skip = out.values['--skip'] ? out.values['--skip'].split(',').map((s) => s.trim()).filter(Boolean) : [];
  for (const s of skip) if (!SECTIONS.includes(s)) throw new Error(`--skip: unknown section "${s}" (use ${SECTIONS.join(', ')})`);
  out.skip = new Set(skip);
  out.stock = plan.parseStock(out.values['--stock']);
  return out;
}

/** Write a file with mode 0600 even when it already exists (writeFileSync's mode only applies on creation). */
function writePrivateFile(file, text) {
  fs.writeFileSync(file, text, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch (e) {
    /* chmod is a no-op on some filesystems (Windows); the file was still created */
  }
}

function findPublicDir(explicit) {
  const candidates = [explicit, process.env.CATALOGUE_PUBLIC_DIR, path.resolve(process.cwd(), '../frontend/public'), path.resolve(process.cwd(), '../flower-ecommerce-platform/frontend/public')].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isDirectory()) return path.resolve(c);
    } catch (e) {
      /* try next */
    }
  }
  return null;
}

/** fileExists(publicPath) for paths such as "/images/hero/hero-1.webp"; never escapes the public dir. */
function makeFileExists(publicDir) {
  return (p) => {
    if (!publicDir || typeof p !== 'string' || !p.startsWith('/')) return false;
    const full = path.resolve(publicDir, `.${p}`);
    if (full !== publicDir && !full.startsWith(publicDir + path.sep)) return false;
    try {
      return fs.statSync(full).isFile();
    } catch (e) {
      return false;
    }
  };
}

function loadPrisma() {
  try {
    return require(path.join(process.cwd(), 'prisma/generated/prisma')).PrismaClient;
  } catch (e) {
    return require('@prisma/client').PrismaClient;
  }
}

function showChanges(label, changes, verbose, fields) {
  console.log(`  ${label}: ${changes.length} change(s)`);
  const list = verbose ? changes : changes.slice(0, 3);
  for (const c of list) {
    const diff = fields.map((f) => `${f}: ${plan.brief(c.before[f])} -> ${plan.brief(c.after[f])}`).join('; ');
    console.log(`    - ${c.key}  ${diff}`);
  }
  if (!verbose && changes.length > list.length) console.log(`    ... and ${changes.length - list.length} more (use --verbose to list all)`);
}

function fmtCounts(o) {
  const e = Object.entries(o || {});
  return e.length ? e.map(([k, v]) => `${k} ${v}`).join(', ') : 'none';
}

async function buildPlan(prisma, opts) {
  const result = { sections: {}, changes: [], sliderCreates: [], notes: [] };
  const verbose = opts.flags.has('--verbose');
  const need = (s) => !opts.skip.has(s);
  const products = await prisma.product.findMany({
    select: { id: true, slug: true, name: true, description: true, stock: true, featured: true, active: true, saleMode: true, image: true },
    orderBy: { id: 'asc' },
  });
  console.log(`Catalogue: ${products.length} product(s).`);

  if (need('descriptions')) {
    const { PRODUCT_COPY } = require('./data/product-copy');
    const { cutFlowerProducts } = require('./data/cut-flowers');
    const oldSeed = Object.fromEntries(cutFlowerProducts.map((p) => [p.slug, p.description]));
    const r = plan.planDescriptions(products, { copy: PRODUCT_COPY, oldSeed, force: opts.flags.has('--force-descriptions') });
    result.changes.push(...r.changes);
    console.log('DESCRIPTIONS (draft copy, owner to review)');
    showChanges('replace', r.changes, verbose, ['description']);
    const left = r.skipped.filter((s) => s.reason === 'live-edited');
    console.log(`  reasons: ${fmtCounts(r.counts)}; kept as-is: ${fmtCounts(countBy(r.skipped, 'reason'))}`);
    if (left.length) console.log(`  NOT overwritten (edited by the owner): ${left.map((s) => s.slug).join(', ')}`);
  }

  if (need('stock')) {
    const rows = await prisma.orderItem.findMany({ select: { productId: true }, distinct: ['productId'] });
    const orderedIds = new Set(rows.map((r) => r.productId));
    const r = plan.planStock(products, { stock: opts.stock, orderedIds });
    result.changes.push(...r.changes);
    console.log(`STOCK (default ${opts.stock} where stock is 0/null; placeholders, NOT real inventory)`);
    showChanges('set', r.changes, verbose, ['stock']);
    console.log(`  kept: ${fmtCounts(r.counts)}`);
  }

  if (need('featured')) {
    const r = plan.planFeatured(products);
    result.changes.push(...r.changes);
    console.log('FEATURED (only switches ON, never OFF)');
    showChanges('feature', r.changes, verbose, ['featured']);
    console.log(`  already featured on the live catalogue: ${r.existingFeatured} (the home page shows at most 8)`);
  }

  if (need('categories')) {
    const cats = await prisma.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: { id: 'asc' } });
    const r = plan.planCategories(cats.map((c) => ({ id: c.id, slug: c.slug, name: c.name, sortOrder: c.sortOrder, active: c.active, productCount: c._count.products })));
    result.changes.push(...r.changes);
    console.log('CATEGORIES (tidy only clear problems)');
    showChanges('tidy', r.changes, true, ['sortOrder', 'name'].filter((f) => r.changes.some((c) => f in c.after)));
    for (const o of r.observations) console.log(`  note: ${o}`);
  }

  if (opts.flags.has('--sliders')) {
    const { HERO_SLIDES, sliderRow } = require('./data/seed-sliders');
    const publicDir = findPublicDir(opts.values['--public-dir']);
    if (!publicDir) console.log('  warning: storefront public/ folder not found (use --public-dir); every slide image counts as missing');
    const count = await prisma.slider.count();
    const r = plan.planSliders(count, HERO_SLIDES, sliderRow, makeFileExists(publicDir));
    result.sliderCreates = r.creates;
    console.log('SLIDERS (draft home slides, only into an empty table)');
    if (r.skippedReason) console.log(`  ${r.skippedReason}`);
    for (const c of r.creates) {
      console.log(`  create "${c.row.title}" -> ${c.row.href}  image ${c.row.image} ${c.imagePresent ? 'found' : 'MISSING'}  => ${c.row.active ? 'active' : 'INACTIVE (turn on in Admin > Sliders after the photo is added)'}`);
    }
    if (r.creates.length) console.log('  reminder: edit each slide\'s alt text in the admin so it describes the real photo.');
  }

  if (opts.flags.has('--images')) {
    const mapFile = opts.values['--map'] || path.join(__dirname, 'data', 'product-images.json');
    const publicDir = findPublicDir(opts.values['--public-dir']);
    console.log('IMAGES (only where empty / placeholder / competitor hotlink)');
    if (!fs.existsSync(mapFile)) {
      console.log(`  no mapping file at ${mapFile}; nothing to do (photos and their mapping arrive later)`);
    } else {
      const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      const errors = plan.validateImageMap(map);
      if (errors.length) throw new Error(`image mapping is invalid:\n  - ${errors.join('\n  - ')}`);
      if (!publicDir) console.log('  warning: storefront public/ folder not found (use --public-dir); mapped files count as missing');
      const r = plan.planImages(products, map, { fileExists: makeFileExists(publicDir), force: opts.flags.has('--force-images') });
      result.changes.push(...r.changes);
      showChanges('set image', r.changes, verbose, ['image']);
      console.log(`  kept: ${fmtCounts(r.counts)}`);
    }
  }
  return result;
}

function countBy(list, field) {
  const o = {};
  for (const x of list) o[x[field]] = (o[x[field]] || 0) + 1;
  return o;
}

/** Apply every planned change in ONE transaction; each update is guarded on the value it saw, so a concurrent edit aborts it. */
async function applyPlan(prisma, result) {
  const created = [];
  await prisma.$transaction(async (tx) => {
    for (const c of result.changes) {
      const model = c.table === 'product' ? tx.product : tx.category;
      const res = await model.updateMany({ where: { id: c.id, ...c.before }, data: c.after });
      if (res.count !== 1) throw new Error(`${c.table} "${c.key}" changed while the script was running; nothing was applied. Run the preview again.`);
    }
    if (result.sliderCreates.length) {
      if ((await tx.slider.count()) > 0) throw new Error('a slider was created while the script was running; nothing was applied.');
      for (const s of result.sliderCreates) {
        const row = await tx.slider.create({ data: s.row });
        created.push({ id: row.id, after: { title: row.title, image: row.image, href: row.href, active: row.active } });
      }
    }
  });
  return created;
}

async function restore(prisma, file, opts) {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!backup || backup.kind !== 'catalogue-content-backup' || !Array.isArray(backup.changes)) throw new Error('not a catalogue-content backup file');
  if (backup.state === 'planned') console.log('warning: this backup was written but the apply did not finish; fields that were never changed will show as conflicts and are left alone.');
  const ids = (t) => backup.changes.filter((c) => c.table === t).map((c) => c.id);
  const sliderIds = (backup.createdSliders || []).map((s) => s.id);
  const [products, categories, sliders] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: ids('product') } } }),
    prisma.category.findMany({ where: { id: { in: ids('category') } } }),
    prisma.slider.findMany({ where: { id: { in: sliderIds } } }),
  ]);
  const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
  const r = plan.planRestore(backup, { product: byId(products), category: byId(categories), slider: byId(sliders) }, { force: opts.flags.has('--force') });
  console.log(`Restore from ${file} (written ${backup.createdAt}): ${r.updates.length} row(s) to revert, ${r.deletes.length} slider(s) to delete, ${r.conflicts.length} conflict(s).`);
  for (const c of r.conflicts.slice(0, 10)) console.log(`  conflict: ${c.table} ${c.key}: ${c.reason} (left alone; --force reverts anyway)`);
  if (!opts.flags.has('--apply')) {
    console.log('Preview only. Nothing was changed. Add --apply to restore.');
    return;
  }
  await prisma.$transaction(async (tx) => {
    for (const u of r.updates) {
      const model = u.table === 'product' ? tx.product : tx.category;
      await model.update({ where: { id: u.id }, data: u.data });
    }
    for (const d of r.deletes) await tx.slider.delete({ where: { id: d.id } });
  });
  console.log(`Restored ${r.updates.length} row(s) and deleted ${r.deletes.length} slider(s) (single transaction).`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.flags.has('--help')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const prisma = new (loadPrisma())();
  try {
    if (opts.values['--restore']) {
      await restore(prisma, opts.values['--restore'], opts);
      return;
    }
    const result = await buildPlan(prisma, opts);
    const total = result.changes.length + result.sliderCreates.length;
    console.log(`\nTotal: ${result.changes.length} row update(s), ${result.sliderCreates.length} slider(s) to create.`);
    if (!opts.flags.has('--apply')) {
      console.log('Preview only. Nothing was changed. Review the above, then re-run with --apply.');
      return;
    }
    if (total === 0) {
      console.log('Nothing to change (already up to date). No backup written.');
      return;
    }
    const backupFile = opts.values['--backup'] || path.join(os.tmpdir(), `catalogue-content-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const doc = { kind: 'catalogue-content-backup', version: 1, createdAt: new Date().toISOString(), state: 'planned', changes: result.changes, createdSliders: [] };
    writePrivateFile(backupFile, JSON.stringify(doc, null, 2)); // BEFORE any change; throws (and aborts) if unwritable
    const created = await applyPlan(prisma, result);
    doc.state = 'applied';
    doc.createdSliders = created;
    writePrivateFile(backupFile, JSON.stringify(doc, null, 2));
    console.log(`Applied ${result.changes.length} update(s) and created ${created.length} slider(s) in one transaction.`);
    console.log(`Backup: ${backupFile} (mode 600). Undo with: node prisma/apply-catalogue-content.js --restore ${backupFile} --apply`);
    console.log('In the container that file is lost when the container is recreated; copy it out: docker compose cp app:' + backupFile + ' ./');
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { parseArgs, makeFileExists, findPublicDir };

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  });
}
