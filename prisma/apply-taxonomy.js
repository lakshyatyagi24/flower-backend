// Applies ONLY the editorial taxonomy (occasion tags + category descriptions) to an existing DB.
// Non-destructive: fills EMPTY values only (see data/seed-taxonomy.js). Safe to run after every deploy.
// Run: node prisma/apply-taxonomy.js   (in the image: cd /app/backend && node prisma/apply-taxonomy.js)
const path = require('path');
const { applyTaxonomy } = require('./data/seed-taxonomy');

function loadPrisma() {
  try {
    return require(path.join(process.cwd(), 'prisma/generated/prisma')).PrismaClient;
  } catch (e) {
    return require('@prisma/client').PrismaClient;
  }
}

async function main() {
  const prisma = new (loadPrisma())();
  try {
    const t = await applyTaxonomy(prisma);
    console.log(`Taxonomy: ${t.descriptions} category description(s) set, ${t.tagged} product(s) tagged`, JSON.stringify(t.perTag));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
