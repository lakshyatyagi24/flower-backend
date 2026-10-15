import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetReviewStatusDto, UpsertReviewDto } from './upsert-review.dto';

const errs = async (cls: any, o: object) => (await validate(plainToInstance(cls, o))).map((e) => e.property);

describe('review DTOs', () => {
  const ok = { rating: 4, title: 'Nice', body: 'A perfectly good review.' };
  it('accepts a valid review', async () => expect(await errs(UpsertReviewDto, ok)).toEqual([]));
  it.each([0, 6, 3.5, '4' as any])('rejects rating %p', async (rating) => {
    expect(await errs(UpsertReviewDto, { ...ok, rating })).toContain('rating');
  });
  it('caps body at 1000 and title at 100, body min 10', async () => {
    expect(await errs(UpsertReviewDto, { ...ok, body: 'x'.repeat(1001) })).toContain('body');
    expect(await errs(UpsertReviewDto, { ...ok, body: 'x'.repeat(1000) })).toEqual([]);
    expect(await errs(UpsertReviewDto, { ...ok, title: 'x'.repeat(101) })).toContain('title');
    expect(await errs(UpsertReviewDto, { ...ok, body: 'short' })).toContain('body');
  });
  it('status DTO only accepts the enum', async () => {
    expect(await errs(SetReviewStatusDto, { status: 'APPROVED' })).toEqual([]);
    expect(await errs(SetReviewStatusDto, { status: 'approved' })).toContain('status');
    expect(await errs(SetReviewStatusDto, {})).toContain('status');
  });
});
