/** Hard bounds enforced on every entry point (API, web UI, client libraries). */
export const LIMITS = {
  nameMin: 1,
  nameMax: 120,
  slugMax: 140,
  emailMax: 254,
  passwordMin: 12,
  passwordMax: 200,
  environmentMax: 40,
  tagMax: 40,
  tagsMax: 20,
  /** 30 seconds keeps the detection loop (10s tick) meaningful. */
  periodSecondsMin: 30,
  periodSecondsMax: 31_536_000,
  graceSecondsMin: 0,
  graceSecondsMax: 604_800,
  /** Ping bodies are truncated at ingestion; never stored in full. */
  pingBodyMax: 10_000,
  syncChecksMax: 500,
  checkKeyMax: 300,
  urlMax: 2048,
} as const;
