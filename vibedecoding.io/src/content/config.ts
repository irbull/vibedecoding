import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.date(),
    updated: z.date().optional(),
    series: z.string().optional(),
    part: z.number().optional(),
    tags: z.array(z.string()),
    status: z.enum(['published', 'draft']).default('draft'),
    canonicalUrl: z.string().url().optional(),
    hero: z.object({
      style: z.string().optional(),
      accent: z.string().optional(),
    }).optional(),
  }),
});

const guide = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    series: z.string().optional(),
    part: z.number().optional(),
    status: z.enum(['published', 'draft']).default('draft'),
    canonicalUrl: z.string().url().optional(),
  }),
});

export const collections = {
  posts,
  guide,
};
