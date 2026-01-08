// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';
import deno from '@deno/astro-adapter';

// https://astro.build/config
// In Astro 5, output: 'static' (default) allows per-page SSR opt-in with prerender = false
export default defineConfig({
  site: 'https://vibedecoding.io',
  adapter: deno(),
  integrations: [
    mdx(),
    sitemap(),
    tailwind(),
  ],
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
  },
});
