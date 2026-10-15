import { Global, Module } from '@nestjs/common';
import { TestSupportController } from './test-support.controller';
import { InMemoryResetTokenStore, RESET_TOKEN_SINK } from './reset-token-sink';

/** Never import this directly: use testSupportModules() from test-support.env.ts. */
@Global()
@Module({
  controllers: [TestSupportController],
  providers: [
    InMemoryResetTokenStore,
    { provide: RESET_TOKEN_SINK, useExisting: InMemoryResetTokenStore },
  ],
  exports: [RESET_TOKEN_SINK],
})
export class TestSupportModule {}
