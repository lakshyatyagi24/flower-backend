import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

@Injectable()
export class UploadsService {
  // Configuration is validated lazily so the app boots without CLOUDINARY_* (local dev, CI).
  private configure(): void {
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      throw new InternalServerErrorException('Uploads are not configured');
    }
    cloudinary.config({
      cloud_name: CLOUDINARY_CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY,
      api_secret: CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  async upload(buffer: Buffer, mime: string, folder: string): Promise<{ url: string; width: number; height: number }> {
    if (!ALLOWED.has(mime)) throw new BadRequestException('Only JPEG, PNG, WebP or AVIF images are allowed');
    if (buffer.length > MAX_BYTES) throw new BadRequestException('Image must be under 5 MB');
    this.configure();
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { folder: `freshpetals/${folder}`, resource_type: 'image', transformation: [{ quality: 'auto', fetch_format: 'auto' }] },
          (err, res) => {
            if (err || !res) return reject(new InternalServerErrorException(err?.message || 'Upload failed'));
            resolve({ url: res.secure_url, width: res.width, height: res.height });
          },
        )
        .end(buffer);
    });
  }
}
