import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DeliveryService } from '../src/delivery/delivery.service';
import { pinDeliveryRules } from './delivery-rules-helper';

describe('Orders validation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreRules: () => Promise<void>;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    restoreRules = await pinDeliveryRules(prisma);
  });
  afterAll(async () => {
    await restoreRules();
    await app.close();
  });

  it('rejects an order with a bad phone and PIN', async () => {
    const res = await request(app.getHttpServer()).post('/orders').send({
      items: [{ productId: 1, quantity: 1 }],
      customerName: 'A', customerEmail: 'a@b.com', customerPhone: '12345',
      shippingAddress: 'x', city: 'Delhi', postalCode: '12',
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toMatch(/mobile number/);
    expect(JSON.stringify(res.body.message)).toMatch(/PIN code/);
  });

  it('ignores a client-supplied total', async () => {
    const res = await request(app.getHttpServer()).post('/orders').send({
      items: [{ productId: 1, quantity: 1 }],
      customerName: 'A', customerEmail: 'a@b.com', customerPhone: '9354016059',
      shippingAddress: 'x', city: 'Delhi', postalCode: '110001', total: 1,
    });
    expect(res.status).toBe(400); // forbidNonWhitelisted
  });

  it('accepts a valid order and stores the normalized phone', async () => {
    const slug = `e2e-task12-${Date.now()}`;
    const product = await prisma.product.create({
      data: { name: 'E2E Rose', slug, price: 100, stock: 5, active: true, saleMode: 'PURCHASE' },
    });
    let orderId: number | undefined;
    try {
      const res = await request(app.getHttpServer()).post('/orders').send({
        items: [{ productId: product.id, quantity: 1 }],
        customerName: 'E2E', customerEmail: 'e2e-task12@example.com', customerPhone: '+91 93540 16059',
        shippingAddress: '1 Test Road', city: 'Delhi', postalCode: '110001', paymentMethod: 'COD',
        deliveryDate: await app.get(DeliveryService).earliestDeliveryDate(),
      });
      expect(res.status).toBe(201);
      orderId = res.body.id;
      expect(res.body.customerPhone).toBe('9354016059');
    } finally {
      if (orderId) {
        await prisma.orderItem.deleteMany({ where: { orderId } });
        await prisma.order.delete({ where: { id: orderId } });
      }
      await prisma.product.delete({ where: { id: product.id } });
    }
  });
});
