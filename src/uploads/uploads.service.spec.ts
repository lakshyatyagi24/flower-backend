import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

const uploadStream = jest.fn();
const config = jest.fn();
jest.mock('cloudinary', () => ({
  v2: {
    config: (...a: unknown[]) => config(...a),
    uploader: { upload_stream: (...a: unknown[]) => uploadStream(...a) },
  },
}));

import { UploadsService } from './uploads.service';

const KEYS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;

describe('UploadsService', () => {
  const svc = new UploadsService();
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    uploadStream.mockReset();
    config.mockReset();
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const configured = () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'cloud';
    process.env.CLOUDINARY_API_KEY = 'key';
    process.env.CLOUDINARY_API_SECRET = 'secret';
  };
  /** upload_stream(opts, cb) returns a writable; end(buffer) triggers the callback with the given outcome. */
  const stream = (outcome: { err?: any; res?: any }) => {
    uploadStream.mockImplementation((_opts: unknown, cb: (e: any, r: any) => void) => ({
      end: jest.fn(() => cb(outcome.err ?? null, outcome.res ?? null)),
    }));
  };

  it('rejects non-images', async () => {
    await expect(svc.upload(Buffer.from('x'), 'application/pdf', 'products')).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['image/svg+xml', 'image/gif', 'text/html', ''])('rejects mime %p (SVG/HTML could carry scripts)', async (mime) => {
    await expect(svc.upload(Buffer.from('x'), mime, 'products')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects > 5MB', async () => {
    await expect(svc.upload(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/jpeg', 'products')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates the file BEFORE checking configuration or contacting Cloudinary', async () => {
    configured();
    await expect(svc.upload(Buffer.from('x'), 'application/pdf', 'products')).rejects.toBeInstanceOf(BadRequestException);
    expect(config).not.toHaveBeenCalled();
    expect(uploadStream).not.toHaveBeenCalled();
  });

  it('rejects clearly when Cloudinary is not configured', async () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    const p = svc.upload(Buffer.from('tiny-jpeg'), 'image/jpeg', 'products');
    await expect(p).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(p).rejects.toThrow('Uploads are not configured');
    expect(uploadStream).not.toHaveBeenCalled();
  });

  it.each(KEYS)('treats a missing or blank %s as not configured', async (key) => {
    configured();
    process.env[key] = '';
    await expect(svc.upload(Buffer.from('x'), 'image/png', 'products')).rejects.toThrow('Uploads are not configured');
  });

  it('accepts exactly 5MB of each allowed type and returns url + dimensions from the secure URL', async () => {
    configured();
    stream({ res: { secure_url: 'https://res.cloudinary.com/cloud/a.webp', width: 800, height: 600 } });
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
      await expect(svc.upload(Buffer.alloc(5 * 1024 * 1024), mime, 'products')).resolves.toEqual({
        url: 'https://res.cloudinary.com/cloud/a.webp', width: 800, height: 600,
      });
    }
  });

  it('configures with the env credentials over https and uploads into freshpetals/<folder>', async () => {
    configured();
    stream({ res: { secure_url: 'https://x/y.jpg', width: 1, height: 1 } });
    await svc.upload(Buffer.from('img'), 'image/jpeg', 'sliders');
    expect(config).toHaveBeenCalledWith({ cloud_name: 'cloud', api_key: 'key', api_secret: 'secret', secure: true });
    expect(uploadStream.mock.calls[0][0]).toMatchObject({ folder: 'freshpetals/sliders', resource_type: 'image' });
  });

  it('surfaces a Cloudinary error as a 500 carrying its message, and a missing result as "Upload failed"', async () => {
    configured();
    stream({ err: { message: 'quota exceeded' } });
    await expect(svc.upload(Buffer.from('img'), 'image/png', 'products')).rejects.toThrow('quota exceeded');
    stream({});
    const p = svc.upload(Buffer.from('img'), 'image/png', 'products');
    await expect(p).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(p).rejects.toThrow('Upload failed');
  });
});
