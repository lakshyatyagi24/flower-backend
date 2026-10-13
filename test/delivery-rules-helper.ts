import type { PrismaService } from '../src/prisma/prisma.service';

const KEYS = ['delivery.cutoffTime', 'delivery.leadTimeDays'];

/**
 * Pins the cut-off to 23:59 and lead time to 1 day so the earliest date is "tomorrow" for almost the whole day,
 * instead of flipping at 15:00 IST or at midnight mid-run. Returns a function that restores the previous rows.
 */
export async function pinDeliveryRules(prisma: PrismaService): Promise<() => Promise<void>> {
  const previous = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
  const put = (key: string, value: string) =>
    prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  await put('delivery.cutoffTime', '23:59');
  await put('delivery.leadTimeDays', '1');
  return async () => {
    await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
    for (const r of previous) await prisma.setting.create({ data: { key: r.key, value: r.value } });
  };
}
