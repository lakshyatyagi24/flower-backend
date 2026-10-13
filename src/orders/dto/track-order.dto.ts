import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of `POST /orders/track/:id`. The email travels in the body (not the query string) so it never lands
 * in access logs, proxies or browser history. Deliberately as lenient as the legacy GET route: a value that
 * is not a valid email simply cannot match any order and gets the same generic 404.
 */
export class TrackOrderDto {
  @IsString()
  @MinLength(1, { message: 'Email is required to track order' })
  @MaxLength(254)
  email!: string;
}
