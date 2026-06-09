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

  // Allowlist of key prefixes that are safe to expose to unauthenticated
  // storefront clients. Anything not matching (e.g. payment.*, future
  // mail.*/sms.* credentials) is withheld by default — an allowlist fails
  // closed, unlike a denylist that leaks any newly-added secret namespace.
  private static readonly PUBLIC_PREFIXES = [
    'store.',
    'social.',
    'homepage.',
    'trust.',
    'delivery.',
    'policies.',
    'shipping.',
    'seo.',
  ];

  async getPublic(): Promise<Record<string, string>> {
    const all = await this.getAll();
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (SettingsService.PUBLIC_PREFIXES.some((p) => k.startsWith(p))) {
        out[k] = v;
      }
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
