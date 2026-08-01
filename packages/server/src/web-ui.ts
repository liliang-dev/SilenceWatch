import { type NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * Serves the compiled Angular application from the same process and the same
 * image: self-hosting must stay a single container.
 *
 * Its own module rather than a function in main.ts, because main.ts is an entry
 * point — importing it runs bootstrap(). Keeping this here is what lets
 * web-ui.e2e-spec.ts serve a real file through it, which is otherwise the one
 * path no suite reaches: the plugin is registered during bootstrap and not in
 * AppModule, so a breaking change in it surfaces only in the container.
 */
export async function serveWebUi(app: NestFastifyApplication, root: string): Promise<void> {
  const fastifyStatic = (await import('@fastify/static')).default;

  await app.register(fastifyStatic as never, {
    root,
    // Hashed asset filenames may be cached forever; index.html never.
    //
    // @fastify/static 10 hands this callback the Fastify reply, where version 8
    // handed it the raw Node response. The two spell the same operation
    // differently — `header` against `setHeader` — so the old form did not fail
    // to compile or to start, it threw on the first asset actually served.
    setHeaders: (reply: { header: (name: string, value: string) => void }, path: string) => {
      reply.header(
        'cache-control',
        /\.[0-9a-f]{8,}\.(js|css|woff2?|svg|png|jpg|webp)$/i.test(path)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
    },
  });
}
