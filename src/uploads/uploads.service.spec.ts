import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { UploadsService } from './uploads.service';

describe('UploadsService', () => {
  const svc = new UploadsService();
  const saved = process.env.CLOUDINARY_CLOUD_NAME;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = saved;
  });

  it('rejects non-images', async () => {
    await expect(svc.upload(Buffer.from('x'), 'application/pdf', 'products')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects > 5MB', async () => {
    await expect(svc.upload(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/jpeg', 'products')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects clearly when Cloudinary is not configured', async () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    const p = svc.upload(Buffer.from('tiny-jpeg'), 'image/jpeg', 'products');
    await expect(p).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(p).rejects.toThrow('Uploads are not configured');
  });
});
