import { z } from 'zod';
import { positiveInt } from '../env-helpers';

/** How long history is kept. */
export const retentionShape = {
  /** Default ping retention; per-project overrides win. */
  PING_RETENTION_DAYS: positiveInt(1, 3_650).default(90),
  PURGE_CRON: z.string().min(1).default('17 3 * * *'),
  /**
   * How long the audit trail is kept. Far longer than ping history on
   * purpose: "who revoked that key in March" is a question asked in
   * September, and a trail that has already been purged answers nothing.
   */
  AUDIT_RETENTION_DAYS: positiveInt(1, 3_650).default(365),
};
