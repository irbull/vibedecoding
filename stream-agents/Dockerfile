# Stream Agents Docker Image
# Single image for all 6 worker processes - use different commands in docker-compose

FROM oven/bun:1-alpine

WORKDIR /app

# Copy dependency files first (better layer caching)
COPY package.json bun.lock ./

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY tsconfig.json ./

# Default command (overridden by docker-compose for each service)
CMD ["bun", "run", "scripts/publish_events_to_kafka.ts"]
