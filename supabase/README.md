# Supabase Edge Functions

This directory contains Supabase Edge Functions for the lifestream project.

## Prerequisites

1. Install the Supabase CLI:
   ```bash
   brew install supabase/tap/supabase
   ```

2. Login to Supabase:
   ```bash
   supabase login
   ```

3. Link to your project (one-time setup):
   ```bash
   supabase link --project-ref <your-project-ref>
   ```
   You can find your project ref in the Supabase dashboard URL or project settings.

## Functions

### share-link

Accepts a URL and creates a link in the lifestream schema:
- Normalizes the URL
- Generates deterministic `subject_id` (link:<sha256>)
- Inserts into `subjects`, `links`, and `events` tables

**Endpoint:** `POST /functions/v1/share-link`

**Request body:**
```json
{
  "url": "https://example.com/article",
  "source": "ios-shortcut"  // optional, defaults to "unknown"
}
```

**Response:**
```json
{
  "success": true,
  "subject_id": "link:abc123def456",
  "url_norm": "https://example.com/article"
}
```

## Deploying Functions

Deploy a single function:
```bash
supabase functions deploy share-link
```

Deploy all functions:
```bash
supabase functions deploy
```

## Local Development

Start the local Supabase stack:
```bash
supabase start
```

Serve functions locally (with hot reload):
```bash
supabase functions serve
```

Test locally:
```bash
curl -X POST http://localhost:54321/functions/v1/share-link \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <anon-key>" \
  -d '{"url": "https://example.com"}'
```

## Environment Variables

Edge Functions automatically have access to:
- `SUPABASE_URL` - Your project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (server-side only)
- `SUPABASE_ANON_KEY` - Anonymous key

For custom secrets:
```bash
supabase secrets set MY_SECRET=value
```

List secrets:
```bash
supabase secrets list
```
