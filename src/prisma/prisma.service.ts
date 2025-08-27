import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

// Dynamically require the generated Prisma client so builds work with dist/generated
const getPrisma = () => {
  try {
    // prefer generated client in prisma/generated/prisma (project uses prisma/ folder)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(process.cwd() + '/prisma/generated/prisma').PrismaClient;
  } catch (e) {
    try {
      // older layout: generated/prisma at project root
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(process.cwd() + '/generated/prisma').PrismaClient;
    } catch (e2) {
      // fallback to node_modules (when running after install)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('@prisma/client').PrismaClient;
    }
  }
};

const PrismaClient = getPrisma();

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
