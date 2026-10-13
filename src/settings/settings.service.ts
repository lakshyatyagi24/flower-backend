import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_DEFAULTS } from './setting-defaults';
import { findInvalidPincodeTokens } from '../delivery/pincode-rules';

const DEFAULTS = SETTING_DEFAULTS;

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
    // Free-form key/value map: validate shape only (every key a short string,
    // every value a string). A global DTO cannot express Record<string,string>.
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new BadRequestException('Settings must be an object of string values');
    }
    for (const [k, v] of Object.entries(values)) {
      if (!k || k.length > 128) throw new BadRequestException(`Invalid setting key "${k.slice(0, 40)}"`);
      if (typeof v !== 'string') throw new BadRequestException(`Setting "${k}" must be a string`);
      if (v.length > 20000) throw new BadRequestException(`Setting "${k}" is too long`);
    }
    const badPins = findInvalidPincodeTokens(values['delivery.supportedPincodes']);
    if (badPins.length > 0) {
      const shown = badPins.slice(0, 5).map((t) => `"${t.slice(0, 20)}"`).join(', ');
      throw new BadRequestException(
        `Serviceable PIN codes has invalid entries: ${shown}${badPins.length > 5 ? ' and more' : ''}. Use 6-digit PINs (110001) or prefixes ending in * (1100*), separated by commas, spaces or new lines.`,
      );
    }
    const updates = Object.entries(values);
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
