import { DeliveryController } from './delivery.controller';

describe('DeliveryController.check', () => {
  const make = (serviceable: boolean, restricted: boolean) => {
    const svc: any = { check: jest.fn(async () => ({ serviceable, restricted })) };
    return { svc, ctrl: new DeliveryController(svc) };
  };

  it('says we deliver only when a list is configured and the PIN is on it', async () => {
    const { ctrl, svc } = make(true, true);
    expect(await ctrl.check(' 110001 ')).toEqual({
      serviceable: true,
      restricted: true,
      message: 'We deliver to this PIN code.',
    });
    expect(svc.check).toHaveBeenCalledWith('110001');
  });
  it('reports unserviceable honestly', async () => {
    const { ctrl } = make(false, true);
    expect(await ctrl.check('110001')).toEqual({
      serviceable: false,
      restricted: true,
      message: 'We do not deliver to this PIN code yet.',
    });
  });
  it('does not claim delivery when no service area is configured', async () => {
    const { ctrl } = make(true, false);
    const r = await ctrl.check('110001');
    expect(r.serviceable).toBe(true);
    expect(r.restricted).toBe(false);
    expect(r.message).toBe("We'll confirm delivery to your PIN code at checkout.");
    expect(r.message).not.toMatch(/we deliver to/i);
  });
  it('returns serviceable:false with a format message for malformed input, without hitting the service', async () => {
    const { ctrl, svc } = make(true, true);
    for (const bad of [undefined, '', '123', 'abcdef']) {
      const r = await ctrl.check(bad as any);
      expect(r.serviceable).toBe(false);
      expect(r.message).toMatch(/valid 6-digit/);
    }
    expect(svc.check).not.toHaveBeenCalled();
  });
});
