import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser, JwtAuthGuard } from './auth.guard';
import { JwtPayload } from './jwt.util';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body() body: { email: string; password: string; name?: string; phone?: string },
  ) {
    return this.auth.register(body);
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    return this.auth.me(user.sub);
  }
}
