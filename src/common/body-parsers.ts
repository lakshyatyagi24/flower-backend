import { raw } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

export const RAZORPAY_WEBHOOK_PATH = '/payments/razorpay/webhook';

/**
 * Register body parsers. Do NOT use `app.use(express.json())` for the global parser:
 * Nest then skips its own and `req.rawBody` is never captured, which breaks Razorpay
 * webhook signature checks. Use Nest's `useBodyParser` instead.
 *
 * The webhook path is read as raw bytes first (and the JSON parser then skips it), so a
 * validly signed but unparsable body reaches the handler (200 no-op) instead of being
 * rejected by the parser before the signature is checked.
 */
export function applyBodyParsers(app: NestExpressApplication): void {
  app.use(
    RAZORPAY_WEBHOOK_PATH,
    raw({
      type: () => true,
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });
}
