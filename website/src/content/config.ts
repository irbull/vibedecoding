import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.date(),
    readingTime: z.number().optional(),
    tags: z.array(z.string()).optional(),
  }),
});

export const collections = { blog };
