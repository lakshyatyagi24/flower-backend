import 'reflect-metadata';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('answers ok without touching any dependency', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok' });
  });

  it('is exempt from the global rate limiter (monitors must never get a 429)', () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', HealthController)).toBe(
      true,
    );
  });
});
