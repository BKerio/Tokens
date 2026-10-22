import { z } from 'zod';
import { BadRequestError } from '../errors/AppError.js';

/** Validates `input` against `schema`, throwing a 400 with the first issue's message. */
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new BadRequestError(`${path}${issue?.message ?? 'Invalid request'}`);
  }
  return result.data;
}

/** `?page=&limit=` → clamped numbers (limit max 200). */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export function paginate(page: number, limit: number) {
  return { skip: (page - 1) * limit, take: limit };
}

export function pageMeta(total: number, page: number, limit: number) {
  return { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Trims; turns '' into undefined so optional fields can be cleared by omission. */
export const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

/** Like optionalString but '' / null explicitly mean "clear this field" (→ null). */
export const nullableString = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null || v.trim() === '' ? null : v.trim()))
  .optional();
