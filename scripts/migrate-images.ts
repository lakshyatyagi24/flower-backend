/**
 * Image migration (Task 1.6).
 *
 *   npm run images:migrate -- --dry   # no Cloudinary calls, no DB writes
 *   npm run images:migrate            # real run (needs CLOUDINARY_* env)
 *
 * Products: data: URIs -> Cloudinary; res.cloudinary.com -> skipped; anything
 * else (Shopify, http, null...) -> interim royalty-free photo by name rule, or
 * null (storefront shows the placeholder).
 * Sliders / categories: data: URIs -> Cloudinary; non-Cloudinary remote URLs
 * (not starting with "/") -> null.
 * Idempotent: rows already holding their target value are left untouched.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaClient } from '../prisma/generated/prisma';
import { InterimManifest, matchKey } from '../src/catalog/image-rules';

const CLD = 'https://res.cloudinary.com/';
const dry = process.argv.includes('--dry');

const manifest: InterimManifest = JSON.parse(
  readFileSync(join(__dirname, '../prisma/data/interim-images.json'), 'utf8'),
);

if (!dry) {
  const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    console.error(`Refusing to run: missing env var(s): ${missing.join(', ')}. Use --dry to preview.`);
    process.exit(1);
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const prisma = new PrismaClient();
const interimCache: Record<string, string> = {};

async function interimUrl(key: string): Promise<string> {
  if (interimCache[key]) return interimCache[key];
  if (dry) return (interimCache[key] = `<interim:${key}>`);
  const res = await cloudinary.uploader.upload(manifest.images[key].file, {
    folder: 'freshpetals/interim',
    public_id: key,
    overwrite: false,
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  });
  return (interimCache[key] = res.secure_url);
}

async function uploadDataUri(folder: string, publicId: string, dataUri: string): Promise<string> {
  if (dry) return '<cloudinary-upload>';
  const res = await cloudinary.uploader.upload(dataUri, { folder: `freshpetals/${folder}`, public_id: publicId });
  return res.secure_url;
}

const counts = { mapped: 0, nullPlaceholder: 0, uploaded: 0, skipped: 0 };

async function main() {
  console.log(dry ? 'DRY RUN - no Cloudinary calls, no DB writes' : 'LIVE RUN');

  // Products
  const products = await prisma.product.findMany({ select: { id: true, name: true, image: true } });
  for (const p of products) {
    const img = p.image ?? '';
    let next: string | null;
    let kind: string;
    if (img.startsWith(CLD)) {
      counts.skipped++;
      continue;
    } else if (img.startsWith('data:image/')) {
      next = await uploadDataUri('products', `product-${p.id}`, img);
      kind = 'uploaded';
      counts.uploaded++;
    } else {
      const key = matchKey(p.name, manifest.rules);
      if (key) {
        next = await interimUrl(key);
        kind = `mapped:${key}`;
        counts.mapped++;
      } else {
        next = null;
        kind = 'null-placeholder';
        counts.nullPlaceholder++;
        if (p.image === null) {
          console.log(`product ${p.id} ${p.name} -> null [${kind}] (unchanged)`);
          continue;
        }
      }
    }
    console.log(`product ${p.id} ${p.name} -> ${next} [${kind}]`);
    if (!dry) await prisma.product.update({ where: { id: p.id }, data: { image: next } });
  }

  // Sliders and categories
  const rows: { table: 'slider' | 'category'; id: number; image: string | null }[] = [
    ...(await prisma.slider.findMany({ select: { id: true, image: true } })).map((r) => ({ table: 'slider' as const, ...r })),
    ...(await prisma.category.findMany({ select: { id: true, image: true } })).map((r) => ({ table: 'category' as const, ...r })),
  ];
  for (const r of rows) {
    const img = r.image;
    let next: string | null | undefined;
    if (!img || img.startsWith(CLD) || img.startsWith('/')) continue;
    if (img.startsWith('data:image/')) {
      next = await uploadDataUri(`${r.table}s`, `${r.table}-${r.id}`, img);
      counts.uploaded++;
    } else {
      next = null;
    }
    console.log(`${r.table} ${r.id} -> ${next}`);
    if (!dry) {
      if (r.table === 'slider') await prisma.slider.update({ where: { id: r.id }, data: { image: next } });
      else await prisma.category.update({ where: { id: r.id }, data: { image: next } });
    }
  }

  console.log(
    `done${dry ? ' (dry run)' : ''}: products ${products.length} | mapped ${counts.mapped} | null-placeholder ${counts.nullPlaceholder} | uploaded(data URIs) ${counts.uploaded} | skipped(already cloudinary) ${counts.skipped}`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : 'migration failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
