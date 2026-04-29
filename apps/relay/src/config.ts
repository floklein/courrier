import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  RELAY_PUBLIC_URL: z.string().url(),
  RELAY_ADMIN_TOKEN: z.string().min(24),
});

export type RelayConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return configSchema.parse(env);
}
