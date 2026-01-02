import rss from '@astrojs/rss';
import { getCollection, type CollectionEntry } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const allPosts = await getCollection('posts');
  const posts = allPosts
    .filter((post: CollectionEntry<'posts'>) => post.data.status === 'published')
    .sort((a: CollectionEntry<'posts'>, b: CollectionEntry<'posts'>) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: 'vibedecoding',
    description: "Turning life's ambient signals into timely action.",
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      link: `/posts/${post.slug}/`,
      categories: post.data.tags,
    })),
    customData: `<language>en-us</language>`,
  });
}
