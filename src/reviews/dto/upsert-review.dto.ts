import { PartialType } from '@nestjs/mapped-types';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
export class UpsertReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(120) title?: string | null;
  @IsString() @MinLength(10) @MaxLength(2000) body!: string;
}
export class UpdateReviewDto extends PartialType(UpsertReviewDto) {}
