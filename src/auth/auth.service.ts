import {
  Inject,
  Optional,
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeIndianPhone } from '../common/validators';
import { createHash, randomBytes } from 'crypto';
import { MailService } from '../mail/mail.service';
import { hashPassword, signJwt, tokenTtlForRole, verifyPassword } from './jwt.util';
import { RESET_TOKEN_SINK, type ResetTokenSink } from '../test-support/reset-token-sink';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    // Only provided when TestSupportModule is loaded (NODE_ENV=test + ENABLE_TEST_ENDPOINTS=1).
    @Optional() @Inject(RESET_TOKEN_SINK) private readonly resetTokenSink?: ResetTokenSink,
  ) {}

  private static readonly RESET_TTL_MS = 60 * 60 * 1000;

  private hashToken(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }

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

  /** The role claim comes from the DB row; the TTL follows the role (ADMIN 12h, CUSTOMER 7d). */
  private issueToken(user: { id: number; email: string; role: string }) {
    const role = user.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER';
    return signJwt({ sub: user.id, email: user.email, role }, tokenTtlForRole(role));
  }

  async register(input: RegisterInput) {
    const email = input.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Valid email is required');
    }
    if (!input.password || input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with that email already exists');

    const password = await hashPassword(input.password);
    const user = await this.prisma.user.create({
      data: {
        email,
        password,
        name: input.name?.trim() || null,
        phone: input.phone ? normalizeIndianPhone(input.phone) : null,
      },
    });

    const token = this.issueToken(user);
    return { token, user: this.sanitize(user) };
  }

  async login(input: LoginInput) {
    const email = input.email?.trim().toLowerCase();
    if (!email || !input.password) throw new BadRequestException('Email and password are required');
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await verifyPassword(input.password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    const token = this.issueToken(user);
    return { token, user: this.sanitize(user) };
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return this.sanitize(user);
  }

  async forgotPassword(emailRaw: string): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return; // no enumeration
    const raw = randomBytes(32).toString('hex'); // 64 chars
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: this.hashToken(raw), expiresAt: new Date(Date.now() + AuthService.RESET_TTL_MS) },
    });
    this.resetTokenSink?.record(user.email, raw);
    const base = (
      user.role === 'ADMIN'
        ? (process.env.ADMIN_SITE_URL || 'http://localhost:3002')
        : (process.env.PUBLIC_SITE_URL || 'http://localhost:3000')
    ).replace(/\/+$/, '');
    const path = user.role === 'ADMIN' ? '/reset-password' : '/account/reset-password';
    const url = `${base}${path}?token=${raw}`;
    // fire-and-forget so response time does not reveal whether the email exists
    void this.mail.sendPasswordReset(user.email, url).catch(() => undefined);
  }

  async resetPassword(raw: string, password: string): Promise<void> {
    const hashed = await hashPassword(password);
    const invalid = () => new BadRequestException('Invalid or expired reset link');
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: this.hashToken(raw) } });
      if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) throw invalid();
      // Atomic consume: only one concurrent request can delete this row.
      const consumed = await tx.passwordResetToken.deleteMany({ where: { id: row.id } });
      if (consumed.count !== 1) throw invalid();
      await tx.user.update({ where: { id: row.userId }, data: { password: hashed } });
      await tx.passwordResetToken.deleteMany({ where: { userId: row.userId } });
    });
  }
}
