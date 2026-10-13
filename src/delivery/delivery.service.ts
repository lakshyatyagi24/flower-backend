import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isIndianPin } from '../common/validators';
import { SETTING_DEFAULTS } from '../settings/setting-defaults';
import { parsePincodeRules, type ParsedPincodeRules } from './pincode-rules';

export { parsePincodeRules } from './pincode-rules';
export type { ParsedPincodeRules } from './pincode-rules';

export interface ServiceabilityResult {
  serviceable: boolean;
  /** True only when a (valid) PIN list is configured. When false, nothing is restricted. */
  restricted: boolean;
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

  /** Serviceability plus whether any restriction is configured (so callers can word the answer honestly). */
  async check(pin: string): Promise<ServiceabilityResult> {
    const { exact, prefixes } = await this.loadRules();
    const restricted = exact.size > 0 || prefixes.length > 0;
    if (typeof pin !== 'string' || !isIndianPin(pin)) return { serviceable: false, restricted };
    if (!restricted) return { serviceable: true, restricted };
    return { serviceable: exact.has(pin) || prefixes.some((p) => pin.startsWith(p)), restricted };
  }

  /**
   * True when no restriction is configured (empty/missing/unparseable list), or the PIN matches an exact entry
   * or a prefix pattern. A malformed PIN is never serviceable.
   */
  async isServiceable(pin: string): Promise<boolean> {
    return (await this.check(pin)).serviceable;
  }
}
