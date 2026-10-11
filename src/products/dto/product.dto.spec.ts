import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto, UpdateProductDto } from './product.dto';

async function imageErrors(image: string, cls: any = CreateProductDto) {
  const dto = plainToInstance(cls, { name: 'Rose', price: 10, image }) as any;
  const errs = await validate(dto);
  return errs.filter((e) => e.property === 'image');
}

describe('Product DTO image rule', () => {
  it.each([
    'https://example.com/x.jpg',
    'data:image/png;base64,AAAA',
    '//evil.example.com/x.jpg',
    'http://res.cloudinary.com/demo/x.jpg',
  ])('rejects %s', async (img) => {
    expect(await imageErrors(img)).toHaveLength(1);
    expect(await imageErrors(img, UpdateProductDto)).toHaveLength(1);
  });

  it.each([
    'https://res.cloudinary.com/demo/image/upload/v1/x.jpg',
    '/images/x.jpg',
  ])('accepts %s', async (img) => {
    expect(await imageErrors(img)).toHaveLength(0);
    expect(await imageErrors(img, UpdateProductDto)).toHaveLength(0);
  });
});
