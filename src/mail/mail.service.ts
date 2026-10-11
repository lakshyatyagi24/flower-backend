import { Injectable, Logger } from '@nestjs/common';

// STUB: Task 1.4 replaces this with the Resend-backed implementation.
// Keep the sendPasswordReset signature.
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    // Never log reset URLs (they contain the raw token) in production.
    if (process.env.NODE_ENV !== 'production') {
      this.log.log(`[stub] password reset for ${to}: ${resetUrl}`);
    }
  }
}
