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

  /** Never throws. Logs recipient + subject + provider message only (no HTML/URLs). */
  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!to) return;
    if (!this.client) {
      this.log.log(`[mail disabled] to=${to} subject="${subject}"`);
      // Local dev convenience only: surface the first link (e.g. reset link).
      if (process.env.NODE_ENV !== 'production') {
        // Skip the layout's header/footer site links; log the first action link.
        const href = [...html.matchAll(/href="([^"]+)"/g)]
          .map((m) => m[1].replace(/&amp;/g, '&'))
          .find((u) => u !== this.site && u !== this.adminSite);
        if (href) this.log.log(`[mail disabled] first action link: ${href}`);
      }
      return;
    }
    try {
      const { error } = await this.client.emails.send({ from: this.from, to, subject, html });
      if (error) this.log.error(`send failed to=${to} subject="${subject}": ${error.message}`);
    } catch (e) {
      this.log.error(`send threw to=${to} subject="${subject}": ${(e as Error).message}`);
    }
  }

  sendPasswordReset(to: string, url: string): Promise<void> {
    return this.send(to, 'Reset your Fresh Petals password', T.passwordResetHtml(url, this.site));
  }
  async sendOrderPlaced(o: Parameters<typeof T.orderPlacedHtml>[0] & { customerEmail: string | null }): Promise<void> {
    await this.send(o.customerEmail ?? '', `Order #${o.id} received`, T.orderPlacedHtml(o, this.site));
    await this.send(this.admin, `New order #${o.id}`, T.adminOrderHtml(o, this.adminSite));
  }
  sendOrderPaid(o: Parameters<typeof T.orderPaidHtml>[0] & { customerEmail: string | null }): Promise<void> {
    return this.send(o.customerEmail ?? '', `Payment received for order #${o.id}`, T.orderPaidHtml(o, this.site));
  }
  sendOrderShipped(o: Parameters<typeof T.orderShippedHtml>[0] & { customerEmail: string | null }): Promise<void> {
    return this.send(o.customerEmail ?? '', `Order #${o.id} is on its way`, T.orderShippedHtml(o, this.site));
  }
  async sendEnquiryReceived(e: Parameters<typeof T.adminEnquiryHtml>[0]): Promise<void> {
    if (e.customerEmail) await this.send(e.customerEmail, 'We received your enquiry', T.enquiryReceivedHtml(e.customerName, this.site));
    await this.send(this.admin, `New enquiry #${e.id}`, T.adminEnquiryHtml(e, this.adminSite));
  }
  sendNewsletterWelcome(to: string): Promise<void> {
    return this.send(to, 'Welcome to Fresh Petals', T.newsletterWelcomeHtml(this.site));
  }
}
