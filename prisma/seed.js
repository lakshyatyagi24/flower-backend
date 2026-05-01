// Seed script — creates an admin user, business-aligned categories, and the
// cut-flower catalogue. Plants / Bouquets / Arrangements / Hampers categories
// are seeded as enquiry-only or empty so the admin can add real products.
// Run: npx prisma db seed
const path = require('path');
const { scryptSync, randomBytes } = require('crypto');
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

  // Categories aligned to client's business model:
  //   - Cut Flowers (PURCHASE)        → primary, online payment, 0% GST
  //   - Plants (PURCHASE)             → secondary, online payment, 0% GST
  //   - Corporate Bouquets (ENQUIRY)  → bulk-only, 5% GST as gift category
  //   - Arrangements (ENQUIRY)        → custom-built, 5% GST
  //   - Hampers (ENQUIRY)             → custom-built, 5% GST
  // Cut Flowers is upserted by data/cut-flowers.js below; the rest are seeded here.
  const categorySeed = [
    {
      name: 'Plants',
      slug: 'plants',
      description: 'Indoor and outdoor plants. Real photos to be uploaded by the store admin.',
      productType: 'PLANT',
      defaultSaleMode: 'PURCHASE',
      defaultGstRate: 0,
      sortOrder: 2,
    },
    {
      name: 'Corporate Bouquets',
      slug: 'corporate-bouquets',
      description: 'Bulk bouquet orders for corporate events, conferences, and gifting. Enquire for a custom quote.',
      productType: 'BOUQUET',
      defaultSaleMode: 'ENQUIRY',
      defaultGstRate: 5,
      sortOrder: 3,
    },
    {
      name: 'Arrangements',
      slug: 'arrangements',
      description: 'Custom-built floral arrangements for events and gifting. Enquire with your preferences.',
      productType: 'ARRANGEMENT',
      defaultSaleMode: 'ENQUIRY',
      defaultGstRate: 5,
      sortOrder: 4,
    },
    {
      name: 'Hampers',
      slug: 'hampers',
      description: 'Curated gift hampers with flowers, plants, and accents. Enquire for a custom build.',
      productType: 'HAMPER',
      defaultSaleMode: 'ENQUIRY',
      defaultGstRate: 5,
      sortOrder: 5,
    },
  ];

  for (const c of categorySeed) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      create: c,
      update: {
        name: c.name,
        description: c.description,
        productType: c.productType,
        defaultSaleMode: c.defaultSaleMode,
        defaultGstRate: c.defaultGstRate,
        sortOrder: c.sortOrder,
      },
    });
  }
  console.log(`Seeded ${categorySeed.length} non-cut-flower categories`);

  // Retire the legacy retail "Bouquets" category if it exists from an older seed.
  // Soft-deactivate any products previously assigned to it instead of hard-deleting.
  const legacyBouquets = await prisma.category.findUnique({ where: { slug: 'bouquets' } });
  if (legacyBouquets) {
    await prisma.product.updateMany({
      where: { categoryId: legacyBouquets.id },
      data: { active: false },
    });
    await prisma.category.update({
      where: { id: legacyBouquets.id },
      data: { active: false, sortOrder: 99 },
    });
    console.log('Retired legacy retail "Bouquets" category and deactivated its products');
  }

  // Seed cut flowers (real catalogue from theflora snapshot).
  const cutFlowers = await seedCutFlowers(prisma);
  console.log(`Seeded ${cutFlowers.count} cut-flower products under '${cutFlowers.category.slug}'`);

  // Default store settings — placeholders, to be overwritten by the admin
  // via the settings page once they share their real contact details.
  const defaultSettings = {
    'store.name': 'Fresh Petals India',
    'store.email': 'orders@example.com',
    'store.phone': '+91 00000 00000',
    'store.whatsapp': '+91 00000 00000',
    'store.address': 'Delhi NCR — please update with real address',
    'store.instagram': '',
    'store.gstin': '',
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
  console.log('Seeded default settings (placeholders — admin should update)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
