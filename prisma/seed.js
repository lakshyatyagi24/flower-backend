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

  // Real products sourced from theflora.in
  const productSeed = [
    {
      slug: 'blue-gardenia',
      name: 'Blue Gardenia',
      description:
        'A wild yet elegant hand-tied bouquet with 22–24 stems — hydrangeas, oriental lilies, chrysanthemums, asiatic lilies, tuberoses and avalanche roses. Comes with flower food and a care card.',
      price: 2950,
      stock: 20,
      featured: true,
      image:
        'https://cdn.shopify.com/s/files/1/0047/4637/9362/products/blue-gardenia.jpg',
      categoryId: bouquets?.id ?? null,
    },
    {
      slug: 'blush-of-affection',
      name: 'Blush of Affection',
      description:
        'A premium blush-toned hand-tied bouquet with lush farm-fresh blooms in soft pinks and creams. An elegant gift for anniversaries, birthdays, or any occasion that calls for something special.',
      price: 3590,
      stock: 15,
      featured: true,
      image:
        'https://cdn.shopify.com/s/files/1/0047/4637/9362/products/blush-of-affection.jpg',
      categoryId: bouquets?.id ?? null,
    },
    {
      slug: 'flourishing-opulence',
      name: 'Flourishing Opulence',
      description:
        'A festive arrangement of 25–30 farm-fresh blooms — blush pink roses, hot pink spray carnations, chrysanthemums, lilies and alstroemeria. Radiates abundance, gratitude and joy.',
      price: 1850,
      stock: 25,
      featured: false,
      image:
        'https://cdn.shopify.com/s/files/1/0047/4637/9362/products/flourishing-opulence.jpg',
      categoryId: bouquets?.id ?? null,
    },
    {
      slug: 'a-riot-of-colours',
      name: 'A Riot of Colours',
      description:
        'A vibrant explosion of seasonal blooms in cheerful mixed colours — perfect for birthdays, celebrations, and anyone who loves bold, lively florals. Hand-tied with care.',
      price: 2750,
      stock: 18,
      featured: true,
      image:
        'https://cdn.shopify.com/s/files/1/0047/4637/9362/products/a-riot-of-colours.jpg',
      categoryId: bouquets?.id ?? null,
    },
    {
      slug: 'a-pocketful-of-sunshine',
      name: 'A Pocketful of Sunshine',
      description:
        'A charming flower basket arrangement bursting with cheerful yellow and orange blooms. Hand-crafted and ready to display — a bright burst of sunshine for any home or desk.',
      price: 1950,
      stock: 20,
      featured: false,
      image:
        'https://cdn.shopify.com/s/files/1/0047/4637/9362/products/a-pocketful-of-sunshine.jpg',
      categoryId: arrangements?.id ?? null,
    },
    {
      slug: 'brand-new-day',
      name: 'Brand New Day',
      description:
        'A fresh, modern floral basket in soft seasonal colours with a welcoming, relaxed aesthetic. Perfect for new beginnings — new home, new job, new arrival — or simply to brighten someone\'s day.',
      price: 1750,
      stock: 22,
      featured: false,
      image:
        'https://cdn.shopify.com/s/files/1/0047/4637/9362/products/brand-new-day.jpg',
      categoryId: arrangements?.id ?? null,
    },
    {
      slug: 'celebration-hamper',
      name: 'Celebration Hamper',
      description:
        'A beautiful keepsake gift box with farm-fresh flowers, artisan chocolates and a scented candle. The complete celebration gift — thoughtfully packed for birthdays, anniversaries and milestones.',
      price: 2499,
      stock: 10,
      featured: true,
      image:
        'https://cdn.shopify.com/s/files/1/0047/4637/9362/products/celebration-hamper.jpg',
      categoryId: hampers?.id ?? null,
    },
    {
      slug: 'orchid-grace',
      name: 'Orchid Grace',
      description:
        'A graceful Phalaenopsis orchid in a white ceramic pot — long-lasting, elegant, and a timeless living gift. The ceramic pot is a beautiful keepsake long after the blooms have faded.',
      price: 1899,
      stock: 12,
      featured: true,
      image:
        'https://cdn.shopify.com/s/files/1/0047/4637/9362/products/orchid-grace.jpg',
      categoryId: plants?.id ?? null,
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
        featured: p.featured,
        image: p.image,
      },
    });
  }
  console.log(`Seeded ${productSeed.length} products`);

  // Sample reviewers — created idempotently.
  const reviewerSeed = [
    { email: 'priya.s@example.com', name: 'Priya S.' },
    { email: 'rahul.k@example.com', name: 'Rahul K.' },
    { email: 'anjali.m@example.com', name: 'Anjali M.' },
    { email: 'vikram.p@example.com', name: 'Vikram P.' },
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
      productSlug: 'blue-gardenia',
      reviewerEmail: 'priya.s@example.com',
      rating: 5,
      title: 'Absolutely stunning',
      body: 'My Blue Gardenia bouquet arrived perfectly fresh — stems vibrant, packaging immaculate. The hydrangeas and oriental lilies were breathtaking. Lasted over a week!',
    },
    {
      productSlug: 'blue-gardenia',
      reviewerEmail: 'rahul.k@example.com',
      rating: 5,
      title: 'Perfect for a special occasion',
      body: 'Ordered this for my parents\' anniversary. The wild, lush look was exactly what I wanted. The flower food and care card were a nice touch.',
    },
    {
      productSlug: 'a-pocketful-of-sunshine',
      reviewerEmail: 'anjali.m@example.com',
      rating: 5,
      title: 'Brightest basket arrangement',
      body: 'The yellows and oranges were so cheerful! It instantly brightened up my desk. Well-crafted and arrived in perfect condition.',
    },
    {
      productSlug: 'orchid-grace',
      reviewerEmail: 'priya.s@example.com',
      rating: 5,
      title: 'Graceful and long-lasting',
      body: 'A graceful gift — the ceramic pot is a true keeper. The orchid is still blooming two months later. Exceptional quality.',
    },
    {
      productSlug: 'celebration-hamper',
      reviewerEmail: 'rahul.k@example.com',
      rating: 5,
      title: 'Complete celebration in a box',
      body: 'Flowers, chocolates and the candle were all top tier. Everything was beautifully arranged in the keepsake box. My wife was overjoyed!',
    },
    {
      productSlug: 'a-riot-of-colours',
      reviewerEmail: 'vikram.p@example.com',
      rating: 5,
      title: 'Exactly as described',
      body: 'Sent this for a birthday and it was a hit. Vibrant, bold, and full of life. Same-day delivery was seamless.',
    },
    {
      productSlug: 'flourishing-opulence',
      reviewerEmail: 'anjali.m@example.com',
      rating: 4,
      title: 'Beautiful and fresh',
      body: 'Lovely mix of roses, carnations and lilies. Great value for the price. A few stems were slightly smaller than expected but overall very pleased.',
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
