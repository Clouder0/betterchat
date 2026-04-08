FROM docker.io/oven/bun:1.3.6

WORKDIR /app
COPY package.json bun.lock ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/test-utils/package.json packages/test-utils/package.json
RUN bun install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages

EXPOSE 3200
CMD ["bun", "run", "apps/backend/src/server.ts"]
