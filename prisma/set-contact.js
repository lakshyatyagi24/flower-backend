// One-off: force-update the live store contact settings in the database.
//
// The regular seed (`npx prisma db seed`) is intentionally NON-destructive — it
// will not overwrite a settings row that already exists. So if your database was
// already seeded with the old placeholder phone, re-seeding won't fix it. Run
// this script instead to push the real contact details into the live DB.
//
//   From flower-backend/ (with DATABASE_URL set, or a .env present in this dir):
//     node prisma/set-contact.js
//
const path = require('path');
const fs = require('fs');

// Load DATABASE_URL from .env if it isn't already in the environment (a plain
// `node` run, unlike the Prisma CLI, does not auto-load .env).
if (!process.env.DATABASE_URL) {
  try {
    const env = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) {
    /* no .env — rely on the ambient environment */
  }
}

function loadPrisma() {
  try {
    return require(path.join(process.cwd(), 'prisma/generated/prisma')).PrismaClient;
  } catch (e) {
    return require('@prisma/client').PrismaClient;
  }
}

const PrismaClient = loadPrisma();
const prisma = new PrismaClient();

// Edit these if the details change again.
const CONTACT = {
  'store.name': 'Fresh Petals India',
  'store.phone': '+91 93540 16059',
  'store.whatsapp': '+91 93540 16059',
};

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Set it in flower-backend/.env or the environment, then re-run.');
  }
  for (const [key, value] of Object.entries(CONTACT)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    console.log(`set ${key} = ${value}`);
  }
  console.log('Done — live store contact settings updated.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
