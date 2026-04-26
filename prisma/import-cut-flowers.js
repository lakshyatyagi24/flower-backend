// Stand-alone, idempotent runner that imports the Cut Flowers category and
// product catalogue migrated from theflora.in (snapshot in
// `prisma/data/theflora-snapshot.json`). Safe to run against any database —
// just have DATABASE_URL set:
//
//   node prisma/import-cut-flowers.js
//
// or via the npm script: `npm run db:import-cut-flowers`.
//
// Existing products with the same slug have their merchandising fields
// refreshed (name, description, price, image, featured, category) but their
// `stock` count is preserved so it doesn't overwrite an admin's manual count.
//
// To refresh the source data when theflora.in changes, see the comment at
// the top of `prisma/data/cut-flowers.js`.
const path = require('path');
const { seedCutFlowers } = require('./data/cut-flowers');

function loadPrisma() {
  try {
    return require(path.join(process.cwd(), 'prisma/generated/prisma')).PrismaClient;
  } catch (e) {
    return require('@prisma/client').PrismaClient;
  }
}

async function main() {
  const PrismaClient = loadPrisma();
  const prisma = new PrismaClient();
  try {
    const result = await seedCutFlowers(prisma);
    console.log(
      `Imported ${result.count} cut-flower products under category '${result.category.slug}' (id ${result.category.id}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
