import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto, UpdateProductDto } from './product.dto';

async function imageErrors(image: string, cls: any = CreateProductDto) {
  const dto = plainToInstance(cls, { name: 'Rose', price: 10, image }) as any;
  const errs = await validate(dto);
  return errs.filter((e) => e.property === 'image');
}

describe('Product DTO tags rule', () => {
  const tagErrors = async (tags: unknown, cls: any = CreateProductDto) => {
    const dto = plainToInstance(cls, { name: 'Rose', price: 10, tags }) as any;
    return (await validate(dto)).filter((e) => e.property === 'tags');
  };
  it('accepts omitted, empty, and string arrays', async () => {
    expect(await tagErrors(undefined)).toHaveLength(0);
    expect(await tagErrors([])).toHaveLength(0);
    expect(await tagErrors(['birthday', 'Roses'])).toHaveLength(0);
    expect(await tagErrors(['birthday'], UpdateProductDto)).toHaveLength(0);
  });
  it('rejects non-array, non-string members, >20 items, >40 chars', async () => {
    expect(await tagErrors('birthday')).toHaveLength(1);
    expect(await tagErrors([1, 2])).toHaveLength(1);
    expect(await tagErrors(Array.from({ length: 21 }, (_, i) => `t${i}`))).toHaveLength(1);
    expect(await tagErrors(['a'.repeat(41)])).toHaveLength(1);
    expect(await tagErrors(['a'.repeat(41)], UpdateProductDto)).toHaveLength(1);
  });
});

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
