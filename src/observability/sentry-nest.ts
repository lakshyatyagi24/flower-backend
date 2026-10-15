/* eslint-disable @typescript-eslint/no-require-imports */
import type { DynamicModule, Provider } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { sentryEnabled } from './sentry';

/**
 * Sentry's Nest integration (tracing interceptor + global exception filter).
 * Registered ONLY when SENTRY_DSN_API is set, so an unset DSN leaves Nest's
 * default exception handling completely untouched. The filter extends Nest's
 * BaseExceptionFilter, so response bodies/status codes are unchanged; it skips
 * HttpExceptions (4xx and deliberate 5xx HttpExceptions) and reports the rest.
 */
export function sentryNestWiring(
  env: Record<string, string | undefined> = process.env,
): {
  imports: DynamicModule[];
  providers: Provider[];
} {
  if (!sentryEnabled(env)) return { imports: [], providers: [] };
  const { SentryModule, SentryGlobalFilter } =
    require('@sentry/nestjs/setup') as typeof import('@sentry/nestjs/setup');
  return {
    imports: [SentryModule.forRoot()],
    providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
  };
}
