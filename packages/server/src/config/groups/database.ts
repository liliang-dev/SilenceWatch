import { z } from 'zod';
import { positiveInt } from '../env-helpers';

/** PostgreSQL. */
export const databaseShape = {
  DATABASE_URL: z.string().min(1),
  /** Prisma connection ceiling (CRUD, API, detection). */
  DATABASE_POOL_MAX: positiveInt(1, 200).default(10),
  /** Dedicated pool for the ingestion path: never starved by CRUD traffic. */
  INGEST_POOL_MAX: positiveInt(1, 200).default(10),
  /**
   * Longest a CRUD or API query may run before PostgreSQL cancels it. Without
   * one a query on a connection the network has quietly dropped never fails: it
   * waits for TCP to give up, which takes minutes, with the request behind it.
   * Nothing this API runs is anywhere near thirty seconds.
   */
  DATABASE_STATEMENT_TIMEOUT_MS: positiveInt(1_000, 600_000).default(30_000),
};
