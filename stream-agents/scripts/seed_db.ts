/**
 * Seed Database Script
 * 
 * Creates deterministic test data for:
 * - Links (with subjects, events, content, metadata)
 * - Temperature readings (time-series)
 * - Todos (open and completed)
 * 
 * Run with: bun run scripts/seed_db.ts
 * Run with clean: bun run scripts/seed_db.ts --clean
 * Run clean only: bun run scripts/seed_db.ts --clean-only
 */

import { sql, closeDb, type Subject, type Event, type Link, type LinkContent, type LinkMetadata, type Todo, type TemperatureReading, type TemperatureLatest } from "../src/lib/db";
import { linkSubjectId, normalizeUrl, sensorSubjectId, todoSubjectId } from "../src/lib/subject_id";

// ============================================================
// Test Data Definitions
// ============================================================

const SEED_LINKS = [
  {
    url: "https://example.com/blog/rust-async-programming",
    title: "Understanding Async/Await in Rust",
    tags: ["rust", "programming", "async"],
    summary: "A comprehensive guide to asynchronous programming in Rust.",
    source: "chrome",
    status: "published" as const,
  },
  {
    url: "https://news.ycombinator.com/item?id=12345",
    title: "Show HN: A New Way to Build Web Apps",
    tags: ["hackernews", "webdev", "startup"],
    summary: "Interesting discussion about modern web development frameworks.",
    source: "phone",
    status: "enriched" as const,
  },
  {
    url: "https://docs.github.com/en/actions/quickstart",
    title: "GitHub Actions Quickstart",
    tags: ["github", "ci-cd", "devops"],
    summary: "Getting started with GitHub Actions for CI/CD workflows.",
    source: "chrome",
    status: "fetched" as const,
  },
  {
    url: "https://www.typescriptlang.org/docs/handbook/2/types-from-types.html",
    title: "TypeScript: Creating Types from Types",
    tags: ["typescript", "programming", "types"],
    summary: "Learn about advanced type manipulation in TypeScript.",
    source: "chrome",
    status: "published" as const,
  },
  {
    url: "https://blog.cloudflare.com/workers-ai/",
    title: "Cloudflare Workers AI: Running LLMs at the Edge",
    tags: ["cloudflare", "ai", "edge-computing"],
    summary: "How Cloudflare is bringing AI inference to their edge network.",
    source: "phone",
    status: "new" as const,
  },
  {
    url: "https://www.postgresql.org/docs/current/indexes.html",
    title: "PostgreSQL: Indexes",
    tags: ["postgresql", "database", "performance"],
    summary: "Complete guide to PostgreSQL indexing strategies.",
    source: "chrome",
    status: "enriched" as const,
  },
  {
    url: "https://kafka.apache.org/documentation/#gettingStarted",
    title: "Apache Kafka Documentation - Getting Started",
    tags: ["kafka", "streaming", "messaging"],
    summary: "Official getting started guide for Apache Kafka.",
    source: "agent:discovery",
    status: "fetched" as const,
  },
  {
    url: "https://supabase.com/docs/guides/database/overview",
    title: "Supabase Database Overview",
    tags: ["supabase", "postgresql", "database"],
    summary: "Introduction to Supabase's PostgreSQL database features.",
    source: "chrome",
    status: "published" as const,
  },
  {
    url: "https://bun.sh/docs",
    title: "Bun Documentation",
    tags: ["bun", "javascript", "runtime"],
    summary: "Official documentation for the Bun JavaScript runtime.",
    source: "phone",
    status: "new" as const,
  },
  {
    url: "https://astro.build/blog/astro-4/",
    title: "Astro 4.0 Release",
    tags: ["astro", "frontend", "static-site"],
    summary: "What's new in Astro 4.0 static site generator.",
    source: "chrome",
    status: "enriched" as const,
  },
];

const SEED_SENSORS = [
  { location: "living_room", baseTemp: 21.5, baseHumidity: 45 },
  { location: "bedroom", baseTemp: 19.0, baseHumidity: 50 },
];

const SEED_TODOS = [
  { id: "1001", title: "Review PR for auth module", project: "work", labels: ["code-review", "urgent"], status: "done" as const },
  { id: "1002", title: "Update documentation for API v2", project: "work", labels: ["documentation"], status: "open" as const },
  { id: "1003", title: "Fix memory leak in worker process", project: "work", labels: ["bug", "performance"], status: "done" as const },
  { id: "1004", title: "Write blog post about Kafka learnings", project: "personal", labels: ["writing", "tech"], status: "open" as const },
  { id: "1005", title: "Set up monitoring dashboard", project: "work", labels: ["devops", "monitoring"], status: "open" as const },
  { id: "1006", title: "Grocery shopping", project: "personal", labels: ["errands"], status: "done" as const },
  { id: "1007", title: "Research vector databases", project: "personal", labels: ["learning", "ai"], status: "open" as const },
  { id: "1008", title: "Schedule dentist appointment", project: "personal", labels: ["health"], status: "open" as const },
  { id: "1009", title: "Refactor database schema", project: "work", labels: ["database", "tech-debt"], status: "done" as const },
  { id: "1010", title: "Plan weekend hiking trip", project: "personal", labels: ["outdoor", "planning"], status: "open" as const },
];

// ============================================================
// Helper Functions
// ============================================================

const NOW = new Date();

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ============================================================
// Seeding Functions
// ============================================================

async function seedLinks(): Promise<void> {
  console.log("\n📎 Seeding links...");
  
  let linkCount = 0;
  let contentCount = 0;
  let metadataCount = 0;
  let eventCount = 0;

  for (let i = 0; i < SEED_LINKS.length; i++) {
    const link = SEED_LINKS[i];
    const urlNorm = normalizeUrl(link.url);
    const subjectId = linkSubjectId(link.url);
    const createdAt = daysAgo(SEED_LINKS.length - i);

    // Upsert subject
    await sql`
      INSERT INTO lifestream.subjects (subject, subject_id, created_at, display_name, visibility, meta)
      VALUES ('link', ${subjectId}, ${createdAt}, ${link.title}, 'public', '{}')
      ON CONFLICT (subject, subject_id) DO UPDATE SET display_name = EXCLUDED.display_name
    `;

    // Upsert link
    await sql`
      INSERT INTO lifestream.links (subject_id, url, url_norm, created_at, source, status, visibility, pinned)
      VALUES (${subjectId}, ${link.url}, ${urlNorm}, ${createdAt}, ${link.source}, ${link.status}, 'public', ${i === 0})
      ON CONFLICT (subject_id) DO UPDATE SET status = EXCLUDED.status
    `;
    linkCount++;

    // Insert event: link.added
    await sql`
      INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload)
      VALUES (${createdAt}, ${link.source}, 'link', ${subjectId}, 'link.added', ${JSON.stringify({ url: link.url, url_norm: urlNorm })})
    `;
    eventCount++;

    // Content (for fetched+ statuses)
    if (link.status !== "new") {
      const fetchedAt = hoursAgo((SEED_LINKS.length - i) * 12);
      await sql`
        INSERT INTO lifestream.link_content (subject_id, final_url, title, text_content, fetched_at)
        VALUES (${subjectId}, ${link.url}, ${link.title}, ${'Sample content for: ' + link.title}, ${fetchedAt})
        ON CONFLICT (subject_id) DO UPDATE SET title = EXCLUDED.title
      `;
      contentCount++;

      await sql`
        INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload)
        VALUES (${fetchedAt}, 'agent:fetcher', 'link', ${subjectId}, 'content.fetched', ${JSON.stringify({ title: link.title })})
      `;
      eventCount++;
    }

    // Metadata (for enriched+ statuses)
    if (link.status === "enriched" || link.status === "published") {
      const enrichedAt = hoursAgo((SEED_LINKS.length - i) * 6);
      await sql`
        INSERT INTO lifestream.link_metadata (subject_id, tags, summary_short, summary_long, language, model_version)
        VALUES (${subjectId}, ${link.tags}, ${link.summary}, ${'Extended summary: ' + link.summary}, 'en', 'gpt-4-turbo-preview')
        ON CONFLICT (subject_id) DO UPDATE SET tags = EXCLUDED.tags
      `;
      metadataCount++;

      await sql`
        INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload)
        VALUES (${enrichedAt}, 'agent:enricher', 'link', ${subjectId}, 'enrichment.completed', ${JSON.stringify({ tags: link.tags, summary: link.summary })})
      `;
      eventCount++;
    }

    // Published event
    if (link.status === "published") {
      const publishedAt = hoursAgo((SEED_LINKS.length - i) * 3);
      await sql`
        INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload)
        VALUES (${publishedAt}, 'agent:publisher', 'link', ${subjectId}, 'publish.completed', '{}')
      `;
      eventCount++;
    }
  }

  console.log(`  ✓ Inserted ${linkCount} links`);
  console.log(`  ✓ Inserted ${contentCount} link contents`);
  console.log(`  ✓ Inserted ${metadataCount} link metadatas`);
  console.log(`  ✓ Inserted ${eventCount} link events`);
}

async function seedTemperature(): Promise<void> {
  console.log("\n🌡️  Seeding temperature readings...");

  let readingsCount = 0;
  let latestCount = 0;
  let eventCount = 0;

  for (const sensor of SEED_SENSORS) {
    const subjectId = sensorSubjectId(sensor.location);

    // Upsert subject
    await sql`
      INSERT INTO lifestream.subjects (subject, subject_id, created_at, display_name, visibility, meta)
      VALUES ('sensor', ${subjectId}, ${daysAgo(30)}, ${'Temperature - ' + sensor.location.replace('_', ' ')}, 'private', ${JSON.stringify({ type: 'temperature', unit: 'celsius' })})
      ON CONFLICT (subject, subject_id) DO UPDATE SET display_name = EXCLUDED.display_name
    `;

    // Generate 24 hours of readings (every 10 minutes = 144 readings)
    let latestReading: { occurredAt: string; celsius: number; humidity: number; battery: number } | null = null;
    
    for (let i = 144; i >= 0; i--) {
      const occurredAt = new Date(NOW.getTime() - i * 10 * 60 * 1000).toISOString();
      
      // Add some variation to temperature
      const variation = Math.sin(i / 12) * 2 + (Math.random() - 0.5);
      const celsius = Math.round((sensor.baseTemp + variation) * 10) / 10;
      const humidity = Math.round((sensor.baseHumidity + (Math.random() - 0.5) * 5) * 10) / 10;
      const battery = 95 - i * 0.01;

      await sql`
        INSERT INTO lifestream.temperature_readings (subject_id, occurred_at, celsius, humidity, battery)
        VALUES (${subjectId}, ${occurredAt}, ${celsius}, ${humidity}, ${battery})
        ON CONFLICT (subject_id, occurred_at) DO NOTHING
      `;
      readingsCount++;
      
      latestReading = { occurredAt, celsius, humidity, battery };

      // Only create events for every 6th reading (hourly)
      if (i % 6 === 0) {
        await sql`
          INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload)
          VALUES (${occurredAt}, 'homeassistant', 'sensor', ${subjectId}, 'temp.reading_recorded', ${JSON.stringify({ celsius, humidity })})
        `;
        eventCount++;
      }
    }

    // Latest reading
    if (latestReading) {
      await sql`
        INSERT INTO lifestream.temperature_latest (subject_id, occurred_at, celsius, humidity, battery)
        VALUES (${subjectId}, ${latestReading.occurredAt}, ${latestReading.celsius}, ${latestReading.humidity}, ${latestReading.battery})
        ON CONFLICT (subject_id) DO UPDATE SET 
          occurred_at = EXCLUDED.occurred_at,
          celsius = EXCLUDED.celsius,
          humidity = EXCLUDED.humidity,
          battery = EXCLUDED.battery
      `;
      latestCount++;
    }
  }

  console.log(`  ✓ Inserted ${readingsCount} temperature readings`);
  console.log(`  ✓ Inserted ${latestCount} latest readings`);
  console.log(`  ✓ Inserted ${eventCount} temperature events`);
}

async function seedTodos(): Promise<void> {
  console.log("\n✅ Seeding todos...");

  let todoCount = 0;
  let eventCount = 0;

  for (let i = 0; i < SEED_TODOS.length; i++) {
    const todo = SEED_TODOS[i];
    const subjectId = todoSubjectId("todoist", todo.id);
    const createdAt = daysAgo(SEED_TODOS.length - i);
    const completedAt = todo.status === "done" ? hoursAgo((SEED_TODOS.length - i) * 4) : null;

    // Upsert subject
    await sql`
      INSERT INTO lifestream.subjects (subject, subject_id, created_at, display_name, visibility, meta)
      VALUES ('todo', ${subjectId}, ${createdAt}, ${todo.title}, 'private', ${JSON.stringify({ source: 'todoist' })})
      ON CONFLICT (subject, subject_id) DO UPDATE SET display_name = EXCLUDED.display_name
    `;

    // Upsert todo
    const dueAt = todo.status === "open" ? daysAgo(-Math.floor(Math.random() * 7)) : null;
    await sql`
      INSERT INTO lifestream.todos (subject_id, title, project, labels, status, due_at, completed_at, meta)
      VALUES (${subjectId}, ${todo.title}, ${todo.project}, ${todo.labels}, ${todo.status}, ${dueAt}, ${completedAt}, ${JSON.stringify({ todoist_id: todo.id })})
      ON CONFLICT (subject_id) DO UPDATE SET status = EXCLUDED.status, completed_at = EXCLUDED.completed_at
    `;
    todoCount++;

    // Event: todo.created
    await sql`
      INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload)
      VALUES (${createdAt}, 'todoist', 'todo', ${subjectId}, 'todo.created', ${JSON.stringify({ title: todo.title, project: todo.project, labels: todo.labels })})
    `;
    eventCount++;

    // Event: todo.completed (if done)
    if (todo.status === "done" && completedAt) {
      await sql`
        INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload)
        VALUES (${completedAt}, 'todoist', 'todo', ${subjectId}, 'todo.completed', '{}')
      `;
      eventCount++;
    }
  }

  console.log(`  ✓ Inserted ${todoCount} todos`);
  console.log(`  ✓ Inserted ${eventCount} todo events`);
}

async function verifyCounts(): Promise<void> {
  console.log("\n📊 Verifying data counts...");

  const tables = [
    "subjects",
    "events", 
    "links",
    "link_content",
    "link_metadata",
    "temperature_readings",
    "temperature_latest",
    "todos",
  ];

  for (const table of tables) {
    const result = await sql.unsafe(`SELECT COUNT(*) as count FROM lifestream.${table}`);
    console.log(`  ✓ ${table}: ${result[0].count} rows`);
  }
}

// ============================================================
// Clean Function
// ============================================================

async function cleanDatabase(): Promise<void> {
  console.log("\n🧹 Cleaning database (truncating all tables)...");

  // Order matters due to foreign key constraints
  // Truncate in reverse dependency order
  const tables = [
    "events",
    "annotations",
    "link_metadata",
    "link_content",
    "publish_state",
    "links",
    "temperature_latest",
    "temperature_readings",
    "todos",
    "subjects",
  ];

  for (const table of tables) {
    try {
      await sql.unsafe(`TRUNCATE lifestream.${table} CASCADE`);
      console.log(`  ✓ Cleaned ${table}`);
    } catch (err) {
      console.log(`  ⚠️  ${table}: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cleanFlag = args.includes("--clean");
  const cleanOnlyFlag = args.includes("--clean-only");

  console.log("🌱 Starting database operations...");
  console.log(`   Timestamp: ${NOW.toISOString()}`);
  
  if (cleanOnlyFlag) {
    console.log("   Mode: CLEAN ONLY (will truncate all tables)");
  } else if (cleanFlag) {
    console.log("   Mode: CLEAN + SEED (will truncate all tables, then seed)");
  } else {
    console.log("   Mode: SEED (upsert data)");
  }

  try {
    if (cleanFlag || cleanOnlyFlag) {
      await cleanDatabase();
    }

    if (!cleanOnlyFlag) {
      await seedLinks();
      await seedTemperature();
      await seedTodos();
    }
    
    await verifyCounts();

    if (cleanOnlyFlag) {
      console.log("\n✨ Clean completed successfully!");
    } else {
      console.log("\n✨ Seed completed successfully!");
    }
  } catch (error) {
    console.error("\n❌ Operation failed:", error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
