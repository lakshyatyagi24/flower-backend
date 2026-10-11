import { IsEmail, IsIn, IsOptional } from 'class-validator';

export class SubscribeDto {
  @IsEmail() email!: string;
  @IsOptional() @IsIn(['footer', 'popup', 'checkout']) source?: string;
}
