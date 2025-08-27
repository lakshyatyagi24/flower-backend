(async () => {
  try {
    const { PrismaClient } = require('../prisma/generated/prisma');
    const prisma = new PrismaClient();
    await prisma.$connect();
    console.log('✔ Prisma client connected successfully');
    await prisma.$disconnect();
  } catch (err) {
    console.error('✖ Prisma client test failed:', err);
    process.exit(1);
  }
})();
