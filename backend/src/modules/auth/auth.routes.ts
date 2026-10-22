import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { AuthService } from './auth.service.js';
import { authenticate } from '../../middleware/auth.js';
import { signOAuthState, verifyOAuthState } from '../../lib/jwt.js';
import { AppError } from '../../shared/errors/AppError.js';
import { nullableString, optionalString, parse } from '../../shared/utils/validation.js';

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Email, username or account ID is required'),
  password: z.string().min(1, 'Password is required'),
});

const updateMeSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').optional(),
    username: z.string().trim().min(3, 'Username must be at least 3 characters').optional(),
    email: z.string().trim().email('Invalid email address').optional(),
    phone: nullableString,
    bio: nullableString,
    profileImage: nullableString,
    currentPassword: optionalString,
    newPassword: z.string().min(8, 'Password must be at least 8 characters').optional(),
  })
  .refine((d) => !d.newPassword || !!d.currentPassword, {
    message: 'Current password is required to set a new password',
    path: ['currentPassword'],
  });

const phoneSchema = z.object({ phone: z.string().trim().min(9, 'Enter a valid phone number') });
const customerOtpSchema = phoneSchema.extend({ otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
const identifierSchema = z.object({ identifier: z.string().trim().min(3, 'Enter your email or phone number') });
const verifyResetSchema = identifierSchema.extend({ otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
const resetSchema = verifyResetSchema.extend({ password: z.string().min(8, 'Password must be at least 8 characters') });

// One-time-code endpoints are cheap to call and expensive to abuse (SMS cost,
// brute force) - keep them on a short leash.
const OTP_LIMIT = { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } };
const VERIFY_LIMIT = { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } };

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = new AuthService(ctx);

  app.post('/login', { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req) => {
    const { identifier, password } = parse(loginSchema, req.body);
    return { ok: true, data: await auth.login(identifier, password) };
  });

  app.get('/me', { preHandler: authenticate }, async (req) => {
    return { ok: true, data: await auth.me(req.user.userId, req.user.role) };
  });

  app.patch('/me', { preHandler: authenticate }, async (req) => {
    const data = parse(updateMeSchema, req.body);
    return { ok: true, data: await auth.updateMe(req.user.userId, req.user.role, data) };
  });

  // Sessions are stateless JWTs - the client discards its token. Kept so the
  // frontend has a single sign-out call to make.
  app.post('/logout', { preHandler: authenticate }, async () => ({ ok: true, message: 'Logged out successfully' }));

  // ── Customers: phone one-time code ─────────────────────────────────────────
  app.post('/customer/send-otp', OTP_LIMIT, async (req) => {
    const { phone } = parse(phoneSchema, req.body);
    await auth.sendCustomerOtp(phone);
    return { ok: true, message: 'OTP sent successfully.' };
  });

  app.post('/customer/verify-otp', VERIFY_LIMIT, async (req) => {
    const { phone, otp } = parse(customerOtpSchema, req.body);
    return { ok: true, data: await auth.verifyCustomerOtp(phone, otp) };
  });

  // ── Tenants: phone one-time code (once their landlord gives them access) ───
  app.post('/tenant/send-otp', OTP_LIMIT, async (req) => {
    const { phone } = parse(phoneSchema, req.body);
    await auth.sendTenantOtp(phone);
    return { ok: true, message: 'Code sent.' };
  });

  app.post('/tenant/verify-otp', VERIFY_LIMIT, async (req) => {
    const { phone, otp } = parse(customerOtpSchema, req.body);
    return { ok: true, data: await auth.verifyTenantOtp(phone, otp) };
  });

  // ── Password reset (admins, vendors, landlords) ────────────────────────────
  app.post('/forgot-password/send-otp', OTP_LIMIT, async (req) => {
    const { identifier } = parse(identifierSchema, req.body);
    await auth.sendResetCode(identifier);
    return { ok: true, message: 'If an account matches, a verification code has been sent.' };
  });

  app.post('/forgot-password/verify-otp', VERIFY_LIMIT, async (req) => {
    const { identifier, otp } = parse(verifyResetSchema, req.body);
    await auth.verifyResetCode(identifier, otp);
    return { ok: true, message: 'Code verified. You can now reset your password.' };
  });

  app.post('/forgot-password/reset', VERIFY_LIMIT, async (req) => {
    const { identifier, otp, password } = parse(resetSchema, req.body);
    await auth.resetPassword(identifier, otp, password);
    return { ok: true, message: 'Password reset successful. You can now login.' };
  });

  // ── Google sign-in (customers) ─────────────────────────────────────────────
  // The session token is handed back in the URL *fragment*, which browsers
  // never send to servers or write to access logs.
  const toLogin = (fragment: Record<string, string>) =>
    `${ctx.config.FRONTEND_URL}/login#${new URLSearchParams(fragment).toString()}`;

  app.get('/google/redirect', async (_req, reply) => {
    if (!auth.googleConfigured()) return reply.redirect(toLogin({ error: 'Google sign-in is not configured.' }));
    return reply.redirect(auth.googleAuthUrl(signOAuthState()));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/google/callback', async (req, reply) => {
    const { code, state, error } = req.query;
    if (error || !code || !state || !verifyOAuthState(state)) {
      return reply.redirect(toLogin({ error: 'Google sign-in was cancelled or expired.' }));
    }
    try {
      const session = await auth.googleCallback(code);
      return reply.redirect(toLogin({ token: session.token, user: JSON.stringify(session.user) }));
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'Failed to authenticate with Google.';
      req.log.warn({ err }, 'Google sign-in failed');
      return reply.redirect(toLogin({ error: message }));
    }
  });
}
