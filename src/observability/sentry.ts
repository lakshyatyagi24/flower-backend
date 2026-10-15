/* eslint-disable @typescript-eslint/no-require-imports */
import {
  IGNORED_ERRORS,
  isExpectedClientError,
  scrubEvent,
} from './sentry-scrub';

type Env = Record<string, string | undefined>;

export function sentryEnabled(env: Env = process.env): boolean {
  return Boolean(env.SENTRY_DSN_API && env.SENTRY_DSN_API.trim());
}

/** Builds the options object (exported for tests). */
export function buildSentryOptions(env: Env = process.env) {
  return {
    dsn: env.SENTRY_DSN_API!.trim(),
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
    release: env.SENTRY_RELEASE || env.GIT_SHA || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    ignoreErrors: IGNORED_ERRORS,
    beforeSend(
      event: Record<string, any>,
      hint?: { originalException?: unknown },
    ) {
      if (isExpectedClientError(hint?.originalException)) return null;
      return scrubEvent(event);
    },
    beforeSendTransaction(event: Record<string, any>) {
      return scrubEvent(event);
    },
  };
}

/**
 * Initialises Sentry only when SENTRY_DSN_API is set. Without it nothing is
 * imported-at-runtime beyond this module: no client, no network, no warnings.
 * `init` is injectable for tests.
 */
export function initSentry(
  env: Env = process.env,
  init?: (o: any) => unknown,
): boolean {
  if (!sentryEnabled(env)) return false;
  // Lazy require: with no DSN the SDK is never even loaded.
  const run =
    init ?? (require('@sentry/nestjs') as typeof import('@sentry/nestjs')).init;
  run(buildSentryOptions(env));
  return true;
}
