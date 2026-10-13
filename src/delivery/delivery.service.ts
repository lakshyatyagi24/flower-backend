import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isIndianPin } from '../common/validators';
import { SETTING_DEFAULTS } from '../settings/setting-defaults';

const EXACT = /^[1-9]\d{5}$/;
// Prefix pattern: 1-5 leading digits followed by '*', e.g. "1100*".
const PREFIX = /^[1-9]\d{0,4}\*$/;

export interface ParsedPincodeRules {
  exact: Set<string>;
  prefixes: string[];
}

/** Parse the `delivery.supportedPincodes` setting. Separators: commas, whitespace, newlines, semicolons. */
export function parsePincodeRules(raw: string | null | undefined): ParsedPincodeRules {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const token of (raw ?? '').split(/[\s,;]+/)) {
    if (!token) continue;
    if (EXACT.test(token)) exact.add(token);
    else if (PREFIX.test(token)) prefixes.push(token.slice(0, -1));
    // anything else (placeholder text, typos) is ignored
  }
  return { exact, prefixes };
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async loadRules(): Promise<ParsedPincodeRules> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'delivery.supportedPincodes' } });
    const raw = row ? row.value : SETTING_DEFAULTS['delivery.supportedPincodes'];
    const rules = parsePincodeRules(raw);
    if ((raw ?? '').trim() && rules.exact.size === 0 && rules.prefixes.length === 0) {
      // Non-empty but nothing parseable (e.g. leftover placeholder text): do not silently block every order.
      this.logger.warn('delivery.supportedPincodes has no valid entries; treating as unrestricted');
    }
    return rules;
  }

  /**
   * True when no restriction is configured (empty/missing/unparseable list), or the PIN matches an exact entry
   * or a prefix pattern. A malformed PIN is never serviceable.
   */
  async isServiceable(pin: string): Promise<boolean> {
    if (typeof pin !== 'string' || !isIndianPin(pin)) return false;
    const { exact, prefixes } = await this.loadRules();
    if (exact.size === 0 && prefixes.length === 0) return true;
    return exact.has(pin) || prefixes.some((p) => pin.startsWith(p));
  }
}
