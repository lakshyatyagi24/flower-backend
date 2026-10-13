import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isIndianPin } from '../common/validators';
import { SETTING_DEFAULTS } from '../settings/setting-defaults';
import { parsePincodeRules, type ParsedPincodeRules } from './pincode-rules';
import {
  computeEarliest,
  computeOptions,
  formatDeliveryDate,
  isIsoDate,
  NoDeliveryDatesError,
  parseBlackoutDates,
  parseCutoff,
  parseDaysAhead,
  parseLeadTimeDays,
  type DeliveryConfig,
  type DeliveryOptions,
} from './delivery-date';

export type { DeliveryOptions } from './delivery-date';

const DATE_KEYS = ['delivery.cutoffTime', 'delivery.leadTimeDays', 'delivery.blackoutDates', 'delivery.daysAhead'] as const;

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

  /** Delivery-date rules from settings. Missing/bad values fall back to defaults (never throws on bad data). */
  private async loadDateConfig(): Promise<DeliveryConfig> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: [...DATE_KEYS] } } });
    const get = (key: (typeof DATE_KEYS)[number]) => {
      const row = rows.find((r) => r.key === key);
      return row ? row.value : SETTING_DEFAULTS[key];
    };
    return {
      cutoffMinutes: parseCutoff(get('delivery.cutoffTime')).minutes,
      leadTimeDays: parseLeadTimeDays(get('delivery.leadTimeDays')),
      daysAhead: parseDaysAhead(get('delivery.daysAhead')),
      blackout: parseBlackoutDates(get('delivery.blackoutDates')),
    };
  }

  /** Blackouts that leave no deliverable day surface as a 503 the storefront shows as an error state. */
  private guard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof NoDeliveryDatesError) throw new ServiceUnavailableException(e.message);
      throw e;
    }
  }

  /** Earliest deliverable date as `YYYY-MM-DD` (an IST calendar date). */
  async earliestDeliveryDate(now: Date = new Date()): Promise<string> {
    const cfg = await this.loadDateConfig();
    return this.guard(() => computeEarliest(now, cfg));
  }

  async deliveryOptions(now: Date = new Date()): Promise<DeliveryOptions> {
    const cfg = await this.loadDateConfig();
    return this.guard(() => computeOptions(now, cfg));
  }

  /**
   * Throws a 400 with an honest message unless `date` is a real `YYYY-MM-DD` inside
   * [earliest, latest] and not a blackout date. Resolves to the accepted date.
   */
  async validateDeliveryDate(date: string, now: Date = new Date()): Promise<string> {
    const cfg = await this.loadDateConfig();
    const { earliest, latest } = this.guard(() => computeOptions(now, cfg));
    if (!isIsoDate(date) || date < earliest || date > latest) {
      throw new BadRequestException(
        `Please choose a delivery date between ${formatDeliveryDate(earliest)} and ${formatDeliveryDate(latest)}`,
      );
    }
    if (cfg.blackout.includes(date)) {
      throw new BadRequestException("We can't deliver on that date. Please choose another day.");
    }
    return date;
  }
}
