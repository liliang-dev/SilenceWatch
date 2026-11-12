import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      // A blog post's dates: shown under its title, listed on /blog/, and given
      // to search engines as datePublished and dateModified.
      extend: z.object({
        date: z.coerce.date().optional(),
        updated: z.coerce.date().optional(),
      }),
    }),
  }),
};
