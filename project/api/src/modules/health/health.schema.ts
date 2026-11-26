import { z } from 'zod';

export const LivenessSchema = z
  .object({
    status: z.literal('ok'),
  })
  .meta({ id: 'Liveness' });

export type Liveness = z.infer<typeof LivenessSchema>;

export const ReadinessSchema = z
  .object({
    status: z.literal('ok'),
    checks: z.object({
      database: z.literal('up'),
      queue: z.literal('up'),
    }),
  })
  .meta({ id: 'Readiness' });

export type Readiness = z.infer<typeof ReadinessSchema>;
