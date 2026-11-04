import { z } from 'zod';

export const applySchema = z.object({
  organizationName: z.string().trim().min(2).max(80),
  website: z
    .url()
    .max(200)
    .regex(/^https?:\/\//, 'Use an http(s) link')
    .nullish(),
  message: z.string().trim().min(20, 'Tell us a bit more (20+ characters)').max(1000),
});
export const rejectSchema = z.object({ reason: z.string().trim().min(10).max(500) });

export type ApplyInput = z.infer<typeof applySchema>;
