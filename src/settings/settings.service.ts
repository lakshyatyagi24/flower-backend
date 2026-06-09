import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULTS: Record<string, string> = {
  'store.name': 'Fresh Petals India',
  'store.email': 'orders@example.com',
  'store.phone': '+91 93540 16059',
  'store.whatsapp': '+91 93540 16059',
  'store.address': 'Delhi NCR — please update',
  'store.instagram': '',
  'store.gstin': '',
  'shipping.flatRate': '99',
  'shipping.freeThreshold': '1499',
  'payment.stripeKey': '',
  'payment.razorpayKeyId': '',
  'payment.razorpayKeySecret': '',
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany();
    const result: Record<string, string> = { ...DEFAULTS };
    for (const r of rows) result[r.key] = r.value;
    return result;
  }

  async getPublic(): Promise<Record<string, string>> {
    const all = await this.getAll();
    // Strip secrets — never expose payment keys to non-admin clients
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('payment.')) continue;
      out[k] = v;
    }
    return out;
  }

  async upsert(values: Record<string, string>): Promise<Record<string, string>> {
    const updates = Object.entries(values).filter(([k]) => k && k.length < 128);
    await this.prisma.$transaction(
      updates.map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { key },
          create: { key, value: String(value ?? '') },
          update: { value: String(value ?? '') },
        }),
      ),
    );
    return this.getAll();
  }
}
