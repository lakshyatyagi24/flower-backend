import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class CreateProductDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(140) slug?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsNumber() @Min(0) price!: number;
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^(https:\/\/res\.cloudinary\.com\/|\/(?!\/))/, {
    message: 'Image must be an uploaded image (Cloudinary) or a site-relative path',
  })
  image?: string;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsIn(['CUT_FLOWER', 'PLANT', 'BOUQUET', 'ARRANGEMENT', 'HAMPER']) productType?:
    'CUT_FLOWER' | 'PLANT' | 'BOUQUET' | 'ARRANGEMENT' | 'HAMPER';
  @IsOptional() @IsIn(['PURCHASE', 'ENQUIRY']) saleMode?: 'PURCHASE' | 'ENQUIRY';
  @IsOptional() @IsNumber() @Min(0) gstRate?: number;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @IsInt() @Min(1) minOrderQty?: number;
  @IsOptional() @IsInt() categoryId?: number | null;
}
export class UpdateProductDto extends PartialType(CreateProductDto) {}
