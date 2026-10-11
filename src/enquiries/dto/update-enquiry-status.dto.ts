import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
export class UpdateEnquiryStatusDto {
  @IsIn(['NEW', 'CONTACTED', 'QUOTED', 'CONVERTED', 'CLOSED']) status!: string;
  @IsOptional() @IsString() @MaxLength(2000) adminNotes?: string | null;
}
