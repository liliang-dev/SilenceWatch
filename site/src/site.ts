/** The application, which lives on its own host. */
export const APP = 'https://app.silencewatch.com';
export const REPOSITORY = 'https://github.com/liliang-dev/SilenceWatch';
/** The address of this site; the build can be pointed elsewhere for a preview. */
export const SITE = (import.meta.env.SITE ?? 'https://silencewatch.com').replace(/\/$/, '');
