import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const REVIEW_TITLE_MAX = 100;
export const REVIEW_BODY_MAX = 1000;

export class UpsertReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(REVIEW_TITLE_MAX) title?: string | null;
  @IsString() @MinLength(10) @MaxLength(REVIEW_BODY_MAX) body!: string;
}
export class UpdateReviewDto extends PartialType(UpsertReviewDto) {}

export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ReviewStatusValue = (typeof REVIEW_STATUSES)[number];

export class SetReviewStatusDto {
  @IsEnum(REVIEW_STATUSES, { message: 'status must be PENDING, APPROVED or REJECTED' })
  status!: ReviewStatusValue;
}
