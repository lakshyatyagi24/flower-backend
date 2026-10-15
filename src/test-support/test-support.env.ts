import type { DynamicModule, Type } from '@nestjs/common';
import { TestSupportModule } from './test-support.module';

type Env = Record<string, string | undefined>;

/**
 * Decides whether the test-only endpoints exist.
 * - production + ENABLE_TEST_ENDPOINTS set (any non-empty value): refuse to boot.
 * - NODE_ENV=test AND ENABLE_TEST_ENDPOINTS=1: returns [TestSupportModule].
 * - anything else: returns [] so the route is not registered at all.
 */
export function testSupportModules(env: Env = process.env): Array<Type<unknown> | DynamicModule> {
  const flag = env.ENABLE_TEST_ENDPOINTS;
  if (env.NODE_ENV === 'production' && flag !== undefined && flag !== '') {
    throw new Error(
      'ENABLE_TEST_ENDPOINTS must not be set when NODE_ENV=production. ' +
        'Test-only endpoints can never be enabled in production; unset ENABLE_TEST_ENDPOINTS.',
    );
  }
  return env.NODE_ENV === 'test' && flag === '1' ? [TestSupportModule] : [];
}
