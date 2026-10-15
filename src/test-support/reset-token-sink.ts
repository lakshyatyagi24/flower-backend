/**
 * Test-only capture of plaintext password-reset tokens.
 *
 * AuthService receives this sink through an @Optional() injection. It is only
 * ever provided by TestSupportModule, which AppModule imports exclusively when
 * NODE_ENV=test AND ENABLE_TEST_ENDPOINTS=1 (see test-support.env.ts). In every
 * other configuration the injection resolves to undefined and the token never
 * leaves forgotPassword(). Real token storage (sha256 hash in the DB) is
 * untouched.
 */
export const RESET_TOKEN_SINK = Symbol('RESET_TOKEN_SINK');

export interface ResetTokenSink {
  record(email: string, rawToken: string): void;
}

export class InMemoryResetTokenStore implements ResetTokenSink {
  private readonly tokens = new Map<string, string>();

  record(email: string, rawToken: string): void {
    this.tokens.set(email.trim().toLowerCase(), rawToken);
  }

  last(email: string): string | undefined {
    return this.tokens.get(email.trim().toLowerCase());
  }
}
