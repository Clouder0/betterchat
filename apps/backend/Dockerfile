FROM docker.io/oven/bun:1.3.6

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

EXPOSE 3200
CMD ["bun", "run", "apps/backend/src/server.ts"]
