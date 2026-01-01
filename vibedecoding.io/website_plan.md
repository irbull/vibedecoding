# vibedecoding.io Website Plan (Astro) — Minimal / Quiet (Indigo)

This plan describes how to build **vibedecoding.io** as the home for Vibe Decoding: a conceptual + technical blog
series about decoding “life stream vibes” using events, Kafka, agents, and (later) Flink.

Decisions locked in:
- **Style:** Minimal / quiet
- **Accent color:** **Indigo**
- **Branding:** **Wordmark only** (no logo mark for now)
- **Subscriptions:** RSS now, email later
- **Content:** Posts live in this repo, but can embed/feature links from the Supabase “links DB”

---

## North Star

**Vibe Decoding** is about turning ambient signals into timely, contextual action.
The site should feel like that:
- calm, low-noise, content-first
- technically credible without looking “dev-tool loud”
- easy to publish and iterate

A good reference vibe is “reading a thoughtful technical essay”, not “visiting a product landing page”.

---

## Tech stack

### Core
- **Astro** (fast, content-first, minimal JS by default)
- **MDX** for posts (code blocks, callouts, diagrams)
- **Tailwind** for styling (keeps UI consistent and fast to iterate)

### Recommended add-ons
- **Shiki** for syntax highlighting (Astro-friendly)
- **RSS feed**
- **Sitemap + robots**
- **Pagefind** for static full-text search (optional in MVP, great in Week 2)

### Deployment
- **Cloudflare Pages** or **Vercel**
- Domain: **vibedecoding.io**
- Cross-post strategy with **ianbull.com** via canonical links

---

## Visual design system (Minimal / Quiet)

### Palette
- Base: near-white background, near-black text, soft neutral grays
- Accent: **Indigo** (links, highlights, subtle UI accents)

Practical approach:
- Use Indigo *sparingly*:
  - inline links
  - active nav state
  - series pill
  - “definition block” left border / icon
  - small hover states
- Everything else: grayscale

### Typography
- Headings: modern sans (system UI or Inter)
- Body: highly readable (system UI is fine; optional: a readable serif if you prefer later)
- Code: monospace with soft background, rounded corners

### Layout
- Narrow reading column (≈ 65–75ch)
- Large vertical rhythm (more space, fewer separators)
- Subtle TOC on desktop (sticky, light weight)
- Dark mode supported from day 1

### Branding (wordmark only)
- Wordmark: **“vibedecoding”** (lowercase looks calm and modern)
- No icon/logo mark initially
- Favicon:
  - minimal: “v” or a single indigo dot
  - keep it quiet and recognizable

---

## Information architecture

### Top nav (simple)
- **Home**
- **Start Here**
- **Series**
- **Stream**
- **About**
- **RSS**

### Core pages

#### 1) Home
- Wordmark + one-sentence definition block
- “Start Here” call-to-action
- Latest posts
- Featured series cards (quiet, minimal)

#### 2) Start Here
A curated reading path:
- Part 0: Conceptual introduction
- Part 1: Event model + life stream
- Part 2: Agents + enrichment loops
- Part 3: Kafka patterns
- Part 4: Flink: decoding time
- Part 5: Voice notes + context triggers

This page is designed to reduce “where do I begin?” friction.

#### 3) Series index
- Each series has:
  - a short intro paragraph
  - ordered parts with dates
  - progress pill “Part N of M”
  - next/prev navigation

#### 4) Post template
- Clean reading experience
- Mini-TOC on desktop (optional)
- Callouts:
  - **Principle**
  - **Pattern**
  - **Tradeoff**
  - **Pitfall**
- Code blocks:
  - Shiki highlight
  - copy button
- End-of-post:
  - “Next / Previous” within series
  - “Related posts” by tags

#### 5) Stream (Supabase-powered link stream)
This connects the blog to the “life stream” system.

Pages:
- `/stream` — recent public links + summaries
- `/stream/tags/[tag]` — links by tag
- optional `/stream/links/[subject_id]` — a single link page with metadata

Key constraint:
- Keep the blog fast and mostly static.
- Fetch public link data from Supabase **at build time** (SSG) where possible.

#### 6) About
- Personal framing: why build Vibe Decoding
- Links to ianbull.com
- Social links

#### 7) RSS
- `/rss.xml`

---

## Content model

### Post frontmatter (standardize early)
```yaml
---
title: "Vibe Decoding"
description: "Turning life’s ambient signals into timely action."
date: 2026-01-01
updated: 2026-01-01
series: "Vibe Decoding"
part: 0
tags: ["vibe-decoding", "kafka", "agents"]
status: "published" # or "draft"
canonicalUrl: "https://vibedecoding.io/posts/vibe-decoding/"
hero:
  style: "quiet"
  accent: "indigo"
---
```

### Callout components (MDX)
Create MDX components like:
- `<DefinitionBlock />`
- `<Callout type="principle">...</Callout>`
- `<SeriesPill series="..." part={...} />`

### Link stream embeds inside posts
Support embedding a saved link by `subject_id`:

Example:
```mdx
<LinkCard subjectId="link:abc123..." />
```

Implementation idea:
- Astro build step fetches that link’s public metadata from Supabase
- Render title, tags, short summary, and canonical URL

---

## Supabase integration (Stream)

### Data access rule
- Only fetch **public** links (visibility = public)
- Use a Supabase service key only during build/deploy (server-side), never in client JS.

### Build-time generation (preferred)
- `getStaticPaths()` for `/stream/tags/[tag]` based on tag list
- `/stream` page pulls recent links
- optionally generate `/stream/links/[subject_id]` pages

### If dynamic is needed later
- Use SSR for Stream pages only, keep the rest SSG.
- Or a tiny API endpoint to proxy requests server-side.

---

## SEO + sharing

### SEO basics
- clean URLs: `/posts/...`
- canonical tags (especially for cross-posts on ianbull.com)
- sitemap.xml + robots.txt
- JSON-LD for BlogPosting

### OG images (quiet template)
Default OG template:
- wordmark
- post title
- subtle thin “signal line” graphic
- indigo accent bar/dot

Allow per-post overrides later.

---

## MVP roadmap

### MVP (Week 1)
- Astro scaffold + deploy to vibedecoding.io
- Layout + nav + footer
- Post template (MDX)
- Tags page + Series page
- Start Here page
- RSS + sitemap
- Publish Part 0 post

### Week 2
- Stream pages pulling public links from Supabase
- Pagefind search
- code copy button
- Mermaid diagrams (optional)

### Later
- “Dashboard” page showing:
  - trending topics (from Flink output)
  - latest enriched links
- Email signup
- more sophisticated “reading path” UX

---

## Suggested repo structure
```
vibedecoding-site/
  astro.config.mjs
  tailwind.config.mjs
  src/
    layouts/
      BaseLayout.astro
      PostLayout.astro
    components/
      Wordmark.astro
      DefinitionBlock.astro
      Callout.astro
      LinkCard.astro
      SeriesPill.astro
    pages/
      index.astro
      start-here.astro
      series/
      stream/
      about.astro
      rss.xml.ts
    content/
      posts/
  public/
  scripts/
    sync-stream-tags.mjs (optional)
```

---

## Deliverables checklist
- [ ] Astro project created + deployed
- [ ] Theme implemented (light + dark, indigo accent)
- [ ] Wordmark header implemented
- [ ] Post layout (MDX) + callouts + TOC
- [ ] Series index + tag index
- [ ] Start Here page
- [ ] RSS + sitemap
- [ ] (Week 2) Stream pages from Supabase (public links)
- [ ] Publish first post: “Vibe Decoding” (Part 0)

---

## Open questions (small)
1) Do you want **dark mode** as default-follow-system (recommended) or manual toggle?
2) Do you want `/stream` to be **SSG at build time** (recommended) or **SSR** (easier for frequent updates)?
   - If your link stream updates often, SSR might be better; if weekly, SSG is great.
