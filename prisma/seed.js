// Seed script — creates an admin user, a few categories, and sample products
// Run: npx prisma db seed
const path = require('path');
const { createHmac, scryptSync, randomBytes } = require('crypto');
const { seedCutFlowers } = require('./data/cut-flowers');

function loadPrisma() {
  try {
    return require(path.join(process.cwd(), 'prisma/generated/prisma')).PrismaClient;
  } catch (e) {
    return require('@prisma/client').PrismaClient;
  }
}

const PrismaClient = loadPrisma();
const prisma = new PrismaClient();

function hashPassword(plain) {
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@flowershop.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin1234';

  const adminExisting = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!adminExisting) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashPassword(adminPassword),
        name: 'Store Admin',
        role: 'ADMIN',
      },
    });
    console.log(`Created admin: ${adminEmail} / ${adminPassword}`);
  } else if (adminExisting.role !== 'ADMIN') {
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'ADMIN' } });
    console.log(`Promoted ${adminEmail} to ADMIN`);
  } else {
    console.log(`Admin already present: ${adminEmail}`);
  }

  const categorySeed = [
    { name: 'Bouquets', slug: 'bouquets' },
    { name: 'Arrangements', slug: 'arrangements' },
    { name: 'Hampers', slug: 'hampers' },
    { name: 'Plants', slug: 'plants' },
  ];
  for (const c of categorySeed) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      create: c,
      update: {},
    });
  }
  const bouquets = await prisma.category.findUnique({ where: { slug: 'bouquets' } });
  const arrangements = await prisma.category.findUnique({ where: { slug: 'arrangements' } });
  const hampers = await prisma.category.findUnique({ where: { slug: 'hampers' } });
  const plants = await prisma.category.findUnique({ where: { slug: 'plants' } });

  const productSeed = [
    {
      slug: 'rose-romance',
      name: 'Rose Romance',
      description: 'A dozen long-stem red roses hand-tied with velvet ribbon.',
      price: 1499,
      stock: 25,
      featured: true,
      categoryId: bouquets?.id ?? null,
    },
    {
      slug: 'tulip-trio',
      name: 'Tulip Trio',
      description: 'Spring tulips arranged in a clear glass vase.',
      price: 999,
      stock: 18,
      featured: true,
      categoryId: arrangements?.id ?? null,
    },
    {
      slug: 'lavender-dreams',
      name: 'Lavender Dreams',
      description: 'Calming lavender stems wrapped in kraft.',
      price: 749,
      stock: 30,
      categoryId: bouquets?.id ?? null,
    },
    {
      slug: 'orchid-grace',
      name: 'Orchid Grace',
      description: 'Single-stem phalaenopsis in a ceramic pot.',
      price: 1899,
      stock: 12,
      featured: true,
      categoryId: plants?.id ?? null,
    },
    {
      slug: 'sunflower-sunshine',
      name: 'Sunflower Sunshine',
      description: 'Bright sunflowers paired with greens.',
      price: 899,
      stock: 22,
      categoryId: bouquets?.id ?? null,
    },
    {
      slug: 'celebration-hamper',
      name: 'Celebration Hamper',
      description: 'Flowers, chocolates and a candle in a keepsake box.',
      price: 2499,
      stock: 8,
      featured: true,
      categoryId: hampers?.id ?? null,
    },
  ];
  for (const p of productSeed) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      create: p,
      update: {
        name: p.name,
        description: p.description,
        price: p.price,
      },
    });
  }
  console.log(`Seeded ${productSeed.length} products`);

  // Sample reviewers — created idempotently. Passwords are intentionally simple seed values.
  const reviewerSeed = [
    { email: 'priya.s@example.com', name: 'Priya S.' },
    { email: 'rahul.k@example.com', name: 'Rahul K.' },
    { email: 'anjali.m@example.com', name: 'Anjali M.' },
  ];
  const reviewers = [];
  for (const r of reviewerSeed) {
    const existing = await prisma.user.findUnique({ where: { email: r.email } });
    if (existing) {
      reviewers.push(existing);
    } else {
      const created = await prisma.user.create({
        data: {
          email: r.email,
          password: hashPassword('reviewer1234'),
          name: r.name,
          role: 'CUSTOMER',
        },
      });
      reviewers.push(created);
    }
  }

  const reviewSeed = [
    {
      productSlug: 'rose-romance',
      reviewerEmail: 'priya.s@example.com',
      rating: 5,
      title: 'Beautiful bouquet',
      body: 'Arrived on time and lasted a week. The recipient loved the colours!',
    },
    {
      productSlug: 'rose-romance',
      reviewerEmail: 'rahul.k@example.com',
      rating: 4,
      title: 'Lovely',
      body: 'Stems were fresh, packaging was elegant. Would order again.',
    },
    {
      productSlug: 'tulip-trio',
      reviewerEmail: 'anjali.m@example.com',
      rating: 5,
      title: 'Spring on the table',
      body: 'Tulips lasted longer than expected and the vase is beautiful.',
    },
    {
      productSlug: 'orchid-grace',
      reviewerEmail: 'priya.s@example.com',
      rating: 5,
      title: 'Stunning',
      body: 'A graceful gift — the ceramic pot is a keeper.',
    },
    {
      productSlug: 'celebration-hamper',
      reviewerEmail: 'rahul.k@example.com',
      rating: 5,
      title: 'Amazing quality',
      body: 'Flowers, chocolates and the candle were all top tier.',
    },
  ];
  for (const r of reviewSeed) {
    const product = await prisma.product.findUnique({ where: { slug: r.productSlug } });
    const reviewer = reviewers.find((u) => u.email === r.reviewerEmail);
    if (!product || !reviewer) continue;
    await prisma.review.upsert({
      where: { productId_userId: { productId: product.id, userId: reviewer.id } },
      create: {
        productId: product.id,
        userId: reviewer.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
      },
      update: {
        rating: r.rating,
        title: r.title,
        body: r.body,
      },
    });
  }
  console.log(`Seeded ${reviewSeed.length} reviews`);

  const cutFlowers = await seedCutFlowers(prisma);
  console.log(`Seeded ${cutFlowers.count} cut-flower products under category '${cutFlowers.category.slug}'`);

  const defaultSettings = {
    'store.name': 'Fresh Petals India',
    'store.email': 'care@freshpetalsindia.com',
    'store.phone': '+91 99000 99000',
    'store.address': 'India-wide delivery',
    'shipping.flatRate': '99',
    'shipping.freeThreshold': '1499',
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }
  console.log('Seeded default settings');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
