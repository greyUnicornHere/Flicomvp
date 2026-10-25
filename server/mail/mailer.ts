import nodemailer from 'nodemailer';
import type { DevOutboxMessage } from '../../shared/api.js';
import type { Config } from '../config.js';
import { newId } from '../auth/tokens.js';

export type MailMessage = { to: string; subject: string; text: string; link?: string };

export interface Mailer {
  readonly kind: 'dev-outbox' | 'smtp';
  send(message: MailMessage): Promise<void>;
}

/**
 * Development-only mailer: keeps messages in memory so sign-in links can be opened from /dev/outbox.
 * Never constructed in production (config validation rejects it).
 */
export class DevOutbox implements Mailer {
  readonly kind = 'dev-outbox';
  private messages: DevOutboxMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.messages.unshift({
      id: newId(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      link: message.link ?? null,
      sentAt: new Date().toISOString(),
    });
    this.messages = this.messages.slice(0, 50);
  }

  list(): DevOutboxMessage[] {
    return [...this.messages];
  }
}

export class SmtpMailer implements Mailer {
  readonly kind = 'smtp';
  private transport;

  constructor(private readonly config: Config) {
    this.transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.config.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

export function createMailer(config: Config): Mailer {
  if (config.MAIL_TRANSPORT === 'smtp') return new SmtpMailer(config);
  if (config.NODE_ENV === 'production') throw new Error('dev-outbox mailer cannot be used in production');
  return new DevOutbox();
}

export function signInEmail(link: string, ttlMinutes: number): Omit<MailMessage, 'to'> {
  return {
    subject: 'Your Flico sign-in link',
    link,
    text: [
      'Hello,',
      '',
      'Use this link to sign in to Flico:',
      link,
      '',
      `It expires in ${ttlMinutes} minutes and can be used once.`,
      "If you didn't request this, you can safely ignore this email.",
      '',
      '— Flico',
    ].join('\n'),
  };
}
