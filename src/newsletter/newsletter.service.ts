import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

function csvField(value: string): string {
  // Neutralise spreadsheet formula injection, then RFC-4180 quote if needed.
  let v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCsv(rows: Array<{ email: string; source: string; createdAt: Date }>): string {
  return [
    'email,source,createdAt',
    ...rows.map((r) => [r.email, r.source, r.createdAt.toISOString()].map(csvField).join(',')),
  ].join('\n');
}

@Injectable()
export class NewsletterService {
  constructor(private readonly prisma: PrismaService, private readonly mail: MailService) {}

  // Idempotent and silent about prior membership: callers cannot tell new from existing.
  async subscribe(emailRaw: string, source: string): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    const existing = await this.prisma.subscriber.findUnique({ where: { email } });
    if (existing) return;
    try {
      await this.prisma.subscriber.create({ data: { email, source } });
    } catch (e: any) {
      if (e?.code === 'P2002') return; // concurrent duplicate
      throw e;
    }
    void this.mail.sendNewsletterWelcome(email).catch(() => undefined);
  }

  async list(take = 50, skip = 0) {
    const [items, total] = await Promise.all([
      this.prisma.subscriber.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(take, 500), skip }),
      this.prisma.subscriber.count(),
    ]);
    return { items, total };
  }

  async exportCsv(): Promise<string> {
    const rows = await this.prisma.subscriber.findMany({ orderBy: { createdAt: 'asc' } });
    return toCsv(rows);
  }
}
