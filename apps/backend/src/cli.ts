#!/usr/bin/env bun

const args = process.argv.slice(2);

const flag = (name: string): string | undefined => {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  const eq = args.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
};

const hasFlag = (name: string): boolean => args.includes(name);

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`betterchat - A modern web client for Rocket.Chat

Usage: betterchat --upstream <url> --secret <value> [options]

Required:
  --upstream <url>    Rocket.Chat server URL
  --secret <value>    Session encryption secret

Options:
  --port <number>     Listen port (default: 3200)
  --host <address>    Listen host (default: 0.0.0.0)
  --no-ui             API-only mode, don't serve frontend
  --help, -h          Show this help`);
  process.exit(0);
}

const upstream = flag('--upstream');
const secret = flag('--secret');
const port = flag('--port');
const host = flag('--host');

if (!secret) {
  console.error('Error: --secret is required.\nRun betterchat --help for usage.');
  process.exit(1);
}

if (upstream) process.env.BETTERCHAT_UPSTREAM_URL = upstream;
process.env.BETTERCHAT_SESSION_SECRET = secret;
if (port) process.env.BETTERCHAT_PORT = port;
if (host) process.env.BETTERCHAT_HOST = host;

if (!hasFlag('--no-ui')) {
  process.env.BETTERCHAT_STATIC_DIR = new URL('./public', import.meta.url).pathname;
}

// Static import is safe: startServer() calls getConfig() internally,
// so env vars set above are visible when startServer() runs.
import { startServer } from './server';
startServer();
