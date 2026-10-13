import { DeliveryController } from './delivery.controller';

describe('DeliveryController.check', () => {
  const make = (ok: boolean) => {
    const svc: any = { isServiceable: jest.fn(async () => ok) };
    return { svc, ctrl: new DeliveryController(svc) };
  };

  it('reports serviceable', async () => {
    const { ctrl, svc } = make(true);
    expect(await ctrl.check(' 110001 ')).toEqual({ serviceable: true, message: 'We deliver to this PIN code.' });
    expect(svc.isServiceable).toHaveBeenCalledWith('110001');
  });
  it('reports unserviceable honestly', async () => {
    const { ctrl } = make(false);
    expect(await ctrl.check('110001')).toEqual({
      serviceable: false,
      message: 'We do not deliver to this PIN code yet.',
    });
  });
  it('returns serviceable:false with a format message for malformed input, without hitting the service', async () => {
    const { ctrl, svc } = make(true);
    for (const bad of [undefined, '', '123', 'abcdef']) {
      const r = await ctrl.check(bad as any);
      expect(r.serviceable).toBe(false);
      expect(r.message).toMatch(/valid 6-digit/);
    }
    expect(svc.isServiceable).not.toHaveBeenCalled();
  });
});
