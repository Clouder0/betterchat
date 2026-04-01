# BetterChat

A modern web client for [Rocket.Chat](https://rocket.chat). Connects to any unmodified Rocket.Chat 7.6+ server.

## Quick Start

Requires [Bun](https://bun.sh) >= 1.3.

```bash
bunx @clouder0/betterchat --upstream http://your-rocketchat:3000 --secret your-session-secret
```

Then open `http://localhost:3200` in your browser.

## CLI Reference

```
betterchat --upstream <url> --secret <value> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--upstream <url>` | Rocket.Chat server URL | *required* |
| `--secret <value>` | Session encryption secret | *required* |
| `--port <number>` | Listen port | `3200` |
| `--host <address>` | Listen host | `0.0.0.0` |
| `--no-ui` | API-only mode (don't serve frontend) | off |

All flags can also be set via environment variables — see [`.env.example`](.env.example).

## Self-Hosting

Behind a reverse proxy (nginx, Caddy, etc.), set:
```bash
bunx @clouder0/betterchat --upstream http://rocketchat:3000 --secret $(openssl rand -hex 32)
```

Set `BETTERCHAT_SESSION_COOKIE_SECURE=true` if serving over HTTPS.

## Development

```bash
# Install dependencies
bun install

# Run backend (API on port 3200)
bun --filter @betterchat/backend dev

# Run frontend (Vite dev server on port 3300)
bun run dev:web

# Typecheck all packages
bun run typecheck

# Run unit tests
bun --filter @betterchat/web test
bun --filter @betterchat/backend test

# Build distributable package
bun run build:dist
```

### Integration Tests

Integration tests require a running Rocket.Chat instance with MongoDB. The test stack uses Docker/Podman Compose:

```bash
# Start the test stack (MongoDB + Rocket.Chat + BetterChat backend)
bash scripts/backend-stack-start.sh

# Run integration tests
bash scripts/backend-integration-test.sh

# Tear down
bash scripts/backend-stack-stop.sh
```

Place your Rocket.Chat test license in `tests/integration/fixtures/rocketchat-test-license.txt`.

## License

MIT
