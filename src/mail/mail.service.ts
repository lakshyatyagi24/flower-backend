import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import * as T from './templates';

// Compose passes unset vars as empty strings, so read with `||`, not `??`.
const stripSlash = (u: string) => u.replace(/\/+$/, '');

@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  // Not readonly/private so unit tests can inject a fake client.
  protected client: Pick<Resend, 'emails'> | null = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;
  private readonly from = process.env.MAIL_FROM || 'Fresh Petals <onboarding@resend.dev>';
  private readonly admin = process.env.ADMIN_NOTIFY_EMAIL || '';
  private readonly site = stripSlash(process.env.PUBLIC_SITE_URL || 'http://localhost:3000');
  private readonly adminSite = stripSlash(process.env.ADMIN_SITE_URL || 'http://localhost:3002');

  /**
   * Never throws or rejects. The HTML builder runs inside the try/catch together
   * with the provider call. Logs recipient + subject + error message only
   * (never HTML, URLs or tokens).
   */
  private async deliver(to: string, subject: string, buildHtml: () => string): Promise<void> {
    if (!to) return;
    try {
      const html = buildHtml();
      if (!this.client) {
        this.log.log(`[mail disabled] to=${to} subject="${subject}"`);
        // Local dev convenience only: surface the first action link (e.g. reset link).
        if (process.env.NODE_ENV !== 'production') {
          // Skip the layout's header/footer site links.
          const href = [...html.matchAll(/href="([^"]+)"/g)]
            .map((m) => m[1].replace(/&amp;/g, '&'))
            .find((u) => u !== this.site && u !== this.adminSite);
          if (href) this.log.log(`[mail disabled] first action link: ${href}`);
        }
        return;
      }
      const { error } = await this.client.emails.send({ from: this.from, to, subject, html });
      if (error) this.log.error(`send failed to=${to} subject="${subject}": ${error.message}`);
    } catch (e) {
      this.log.error(`send threw to=${to} subject="${subject}": ${(e as Error)?.message ?? String(e)}`);
    }
  }

  async sendPasswordReset(to: string, url: string): Promise<void> {
    await this.deliver(to, 'Reset your Fresh Petals password', () => T.passwordResetHtml(url, this.site));
  }
  async sendOrderPlaced(o: Parameters<typeof T.orderPlacedHtml>[0] & { customerEmail: string | null }): Promise<void> {
    // Independent: a failure on one mail never stops the other.
    await this.deliver(o.customerEmail ?? '', `Order #${o.id} received`, () => T.orderPlacedHtml(o, this.site));
    await this.deliver(this.admin, `New order #${o.id}`, () => T.adminOrderHtml(o, this.adminSite));
  }
  async sendOrderPaid(o: Parameters<typeof T.orderPaidHtml>[0] & { customerEmail: string | null }): Promise<void> {
    // Online orders skip the placed mail, so the admin hears about them here.
    // Independent: a failure on one mail never stops the other.
    await this.deliver(o.customerEmail ?? '', `Payment received for order #${o.id}`, () => T.orderPaidHtml(o, this.site));
    await this.deliver(this.admin, `New paid order #${o.id}`, () => T.adminOrderHtml(o, this.adminSite));
  }
  async sendOrderShipped(o: Parameters<typeof T.orderShippedHtml>[0] & { customerEmail: string | null }): Promise<void> {
    await this.deliver(o.customerEmail ?? '', `Order #${o.id} is on its way`, () => T.orderShippedHtml(o, this.site));
  }
  async sendEnquiryReceived(e: Parameters<typeof T.adminEnquiryHtml>[0]): Promise<void> {
    await this.deliver(e.customerEmail ?? '', 'We received your enquiry', () => T.enquiryReceivedHtml(e.customerName, this.site));
    await this.deliver(this.admin, `New enquiry #${e.id}`, () => T.adminEnquiryHtml(e, this.adminSite));
  }
  async sendReviewPending(r: Parameters<typeof T.adminReviewPendingHtml>[0]): Promise<void> {
    // Subject is plain text, but user-controlled: drop line breaks (header injection) and cap length.
    const product = r.productName.replace(/[\r\n]+/g, ' ').slice(0, 80);
    await this.deliver(this.admin, `Review awaiting approval: ${product}`, () => T.adminReviewPendingHtml(r, this.adminSite));
  }
  async sendNewsletterWelcome(to: string): Promise<void> {
    await this.deliver(to, 'Welcome to Fresh Petals', () => T.newsletterWelcomeHtml(this.site));
  }
}
