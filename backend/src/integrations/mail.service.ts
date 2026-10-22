import nodemailer, { type Transporter } from 'nodemailer';
import type { EnvConfig } from '../lib/env.js';
import type { Logger } from '../lib/logger.js';

/** Outbound email (password-reset codes). A no-op that logs when SMTP isn't configured. */
export class MailService {
  private transporter: Transporter | null;

  constructor(private config: EnvConfig, private log: Logger) {
    this.transporter = config.SMTP_HOST
      ? nodemailer.createTransport({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
        })
      : null;
  }

  async send(to: string, subject: string, text: string, html?: string): Promise<boolean> {
    if (!this.transporter) {
      this.log.warn({ to, subject }, 'SMTP not configured - email not sent');
      return false;
    }
    try {
      await this.transporter.sendMail({ from: this.config.MAIL_FROM, to, subject, text, html });
      return true;
    } catch (err) {
      this.log.error({ err, to }, 'Failed to send email');
      return false;
    }
  }

  sendPasswordResetCode(to: string, code: string): Promise<boolean> {
    const text = `Your TokenPap password reset code is ${code}. It is valid for 10 minutes.\n\nIf you didn't request this, you can ignore this email.`;
    const html = `<p>Your TokenPap password reset code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>It is valid for 10 minutes. If you didn't request this, you can ignore this email.</p>`;
    return this.send(to, 'Your TokenPap password reset code', text, html);
  }
}
