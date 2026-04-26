import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, signJwt, verifyPassword } from './jwt.util';

interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  phone?: string;
}

interface LoginInput {
  email: string;
  password: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitize(user: { id: number; email: string; name: string | null; phone: string | null; role: string; createdAt: Date }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt,
    };
  }

  async register(input: RegisterInput) {
    const email = input.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Valid email is required');
    }
    if (!input.password || input.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with that email already exists');

    const password = await hashPassword(input.password);
    const user = await this.prisma.user.create({
      data: {
        email,
        password,
        name: input.name?.trim() || null,
        phone: input.phone?.trim() || null,
      },
    });

    const token = signJwt({ sub: user.id, email: user.email, role: user.role as 'CUSTOMER' | 'ADMIN' });
    return { token, user: this.sanitize(user) };
  }

  async login(input: LoginInput) {
    const email = input.email?.trim().toLowerCase();
    if (!email || !input.password) throw new BadRequestException('Email and password are required');
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await verifyPassword(input.password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    const token = signJwt({ sub: user.id, email: user.email, role: user.role as 'CUSTOMER' | 'ADMIN' });
    return { token, user: this.sanitize(user) };
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return this.sanitize(user);
  }
}
