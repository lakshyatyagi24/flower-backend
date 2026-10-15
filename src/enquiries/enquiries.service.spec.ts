import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EnquiriesService } from './enquiries.service';

function make(over: { product?: any } = {}) {
  const prisma: any = {
    product: { findUnique: jest.fn(async () => (over.product === undefined ? { id: 4, name: 'Orchid' } : over.product)) },
    enquiry: {
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      findUnique: jest.fn(async () => ({ id: 1, status: 'NEW' })),
      update: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      groupBy: jest.fn(async () => []),
    },
  };
  const mail: any = { sendEnquiryReceived: jest.fn(async () => undefined) };
  return { svc: new EnquiriesService(prisma, mail), prisma, mail };
}

const base = { customerName: ' Asha ', customerPhone: '+91 98765 43210' };

describe('EnquiriesService.create', () => {
  it('requires a non-blank name', async () => {
    const { svc, prisma } = make();
    await expect(svc.create({ ...base, customerName: '   ' })).rejects.toThrow('Name is required');
    expect(prisma.enquiry.create).not.toHaveBeenCalled();
  });

  it('normalises name, phone and email; defaults the source', async () => {
    const { svc, prisma } = make();
    await svc.create({ ...base, customerEmail: '  Asha@X.COM ' });
    const data = prisma.enquiry.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ customerName: 'Asha', customerPhone: '9876543210', customerEmail: 'asha@x.com', source: 'website' });
  });

  it('stores null instead of blank optional text', async () => {
    const { svc, prisma } = make();
    await svc.create({ ...base, customerEmail: '  ', occasion: ' ', city: '', message: '  ', address: ' ' });
    const data = prisma.enquiry.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ customerEmail: null, occasion: null, city: null, message: null, address: null });
  });

  it('rejects a product that does not exist and creates nothing', async () => {
    const { svc, prisma } = make({ product: null });
    await expect(svc.create({ ...base, productId: 99 })).rejects.toThrow('Product does not exist');
    expect(prisma.enquiry.create).not.toHaveBeenCalled();
  });

  it('fills the product name from the product when not supplied, keeps a supplied one', async () => {
    const a = make();
    await a.svc.create({ ...base, productId: 4 });
    expect(a.prisma.enquiry.create.mock.calls[0][0].data.productName).toBe('Orchid');
    const b = make();
    await b.svc.create({ ...base, productId: 4, productName: 'Custom label' });
    expect(b.prisma.enquiry.create.mock.calls[0][0].data.productName).toBe('Custom label');
  });

  it('rejects an unparseable event date', async () => {
    const { svc, prisma } = make();
    await expect(svc.create({ ...base, eventDate: 'not-a-date' })).rejects.toThrow('Invalid event date');
    expect(prisma.enquiry.create).not.toHaveBeenCalled();
  });

  it('floors the quantity, drops non-positive quantity and negative or non-numeric budget, keeps a zero budget', async () => {
    const a = make();
    await a.svc.create({ ...base, quantity: 12.7, budget: 0 });
    expect(a.prisma.enquiry.create.mock.calls[0][0].data).toMatchObject({ quantity: 12, budget: 0 });
    const b = make();
    await b.svc.create({ ...base, quantity: -3, budget: -1 });
    expect(b.prisma.enquiry.create.mock.calls[0][0].data).toMatchObject({ quantity: null, budget: null });
    const c = make();
    await c.svc.create({ ...base, budget: '5000' as any });
    expect(c.prisma.enquiry.create.mock.calls[0][0].data.budget).toBeNull();
  });

  it('a mail failure never fails the enquiry', async () => {
    const { svc, mail } = make();
    mail.sendEnquiryReceived.mockRejectedValue(new Error('resend down'));
    await expect(svc.create(base)).resolves.toMatchObject({ id: 1 });
    await new Promise((r) => setImmediate(r)); // let the swallowed rejection settle
  });
});

describe('EnquiriesService.list', () => {
  it('rejects an unknown status', async () => {
    const { svc } = make();
    await expect(svc.list({ status: 'BOGUS' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters by a valid status and clamps take to 1..200 and skip to >= 0', async () => {
    const { svc, prisma } = make();
    await svc.list({ status: 'NEW', take: 5000, skip: -4 });
    expect(prisma.enquiry.findMany.mock.calls[0][0]).toMatchObject({ where: { status: 'NEW' }, take: 200, skip: 0 });
    await svc.list({ take: 0 });
    expect(prisma.enquiry.findMany.mock.calls[1][0]).toMatchObject({ take: 1 });
  });

  it('openCount counts NEW, CONTACTED and QUOTED regardless of the status filter', async () => {
    const { svc, prisma } = make();
    await svc.list({ status: 'CLOSED' });
    const openCall = prisma.enquiry.count.mock.calls.find((c: any[]) => c[0].where.status?.in);
    expect(openCall[0].where.status.in).toEqual(['NEW', 'CONTACTED', 'QUOTED']);
  });
});

describe('EnquiriesService status and stats', () => {
  it('getById 404s when missing', async () => {
    const { svc, prisma } = make();
    prisma.enquiry.findUnique.mockResolvedValue(null);
    await expect(svc.getById(1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateStatus validates the status before touching the database', async () => {
    const { svc, prisma } = make();
    await expect(svc.updateStatus(1, 'DONE')).rejects.toThrow('Invalid status');
    expect(prisma.enquiry.findUnique).not.toHaveBeenCalled();
  });

  it('updateStatus 404s for a missing enquiry', async () => {
    const { svc, prisma } = make();
    prisma.enquiry.findUnique.mockResolvedValue(null);
    await expect(svc.updateStatus(1, 'QUOTED')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.enquiry.update).not.toHaveBeenCalled();
  });

  it('updateStatus leaves notes alone when omitted, clears them when blank, sets them otherwise', async () => {
    const { svc, prisma } = make();
    await svc.updateStatus(1, 'CONTACTED');
    expect(prisma.enquiry.update.mock.calls[0][0].data).toEqual({ status: 'CONTACTED' });
    await svc.updateStatus(1, 'CONTACTED', '');
    expect(prisma.enquiry.update.mock.calls[1][0].data).toEqual({ status: 'CONTACTED', adminNotes: null });
    await svc.updateStatus(1, 'QUOTED', 'sent quote');
    expect(prisma.enquiry.update.mock.calls[2][0].data).toEqual({ status: 'QUOTED', adminNotes: 'sent quote' });
  });

  it('stats zero-fills missing statuses and computes open and total', async () => {
    const { svc, prisma } = make();
    prisma.enquiry.groupBy.mockResolvedValue([
      { status: 'NEW', _count: { _all: 3 } },
      { status: 'QUOTED', _count: { _all: 2 } },
      { status: 'CLOSED', _count: { _all: 4 } },
    ]);
    expect(await svc.stats()).toEqual({
      byStatus: { NEW: 3, CONTACTED: 0, QUOTED: 2, CONVERTED: 0, CLOSED: 4 },
      open: 5,
      total: 9,
    });
  });
});
