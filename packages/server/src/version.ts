/**
 * Build identity, reported by /health and stamped into the support bundle.
 *
 * SILENCEWATCH_VERSION and SILENCEWATCH_COMMIT are set at image build time; the
 * fallbacks keep local runs honest instead of claiming a release number.
 */
export const SILENCEWATCH_VERSION = process.env.SILENCEWATCH_VERSION ?? '0.1.0-dev';
export const SILENCEWATCH_COMMIT = process.env.SILENCEWATCH_COMMIT ?? 'unknown';
