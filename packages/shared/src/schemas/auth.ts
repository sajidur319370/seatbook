import { z } from 'zod';
import { PALETTE } from '../constants';
import { emailSchema, passwordSchema, personNameSchema, timezoneSchema } from './common';

export const registerSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Required').max(72),
});
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export const updateMeSchema = z
  .object({ name: personNameSchema, avatarColor: z.enum(PALETTE), timezone: timezoneSchema })
  .partial();
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
