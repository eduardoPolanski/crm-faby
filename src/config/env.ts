import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  WHATSAPP_OWNER_ID: z.string().uuid(),
  WHATSAPP_SESSION_NAME: z.string().min(1).default('default'),
  WHATSAPP_AUTH_DIR: z.string().min(1).default('/data/whatsapp-auth'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export const env = schema.parse(process.env);
