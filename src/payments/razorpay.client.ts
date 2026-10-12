import { Injectable } from '@nestjs/common';
import Razorpay from 'razorpay';

export interface RazorpayClient {
  createOrder(amountPaise: number, receipt: string): Promise<{ id: string }>;
}
export const RAZORPAY_CLIENT = Symbol('RAZORPAY_CLIENT');

/**
 * Real SDK adapter. The SDK is built lazily so the app boots (and COD keeps
 * working) when Razorpay keys are not configured; tests inject a fake instead.
 */
@Injectable()
export class RazorpaySdkClient implements RazorpayClient {
  private sdk: Razorpay | null = null;

  async createOrder(amountPaise: number, receipt: string): Promise<{ id: string }> {
    this.sdk ??= new Razorpay({
      key_id: (process.env.RAZORPAY_KEY_ID ?? '').trim(),
      key_secret: (process.env.RAZORPAY_KEY_SECRET ?? '').trim(),
    });
    // payment_capture: capture automatically in code; do not depend on a dashboard setting (on manual
    // capture, an authorized-only payment would pass verify, never be captured, and be auto-refunded).
    const o = await this.sdk.orders.create({ amount: amountPaise, currency: 'INR', receipt, payment_capture: true });
    return { id: o.id };
  }
}
