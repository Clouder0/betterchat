import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const backendStackStartScript = fileURLToPath(new URL('../../../scripts/backend-stack-start.sh', import.meta.url));
const backendIntegrationTestScript = fileURLToPath(new URL('../../../scripts/backend-integration-test.sh', import.meta.url));

const tempRoots: string[] = [];

const rememberTempRoot = (path: string): string => {
  tempRoots.push(path);
  return path;
};

const fileExists = async (path: string): Promise<boolean> => Bun.file(path).exists();

const installExecutable = async (binDir: string, name: string, body: string): Promise<void> => {
  const executablePath = join(binDir, name);
  await writeFile(
    executablePath,
    `#!/usr/bin/env bash
set -euo pipefail
${body}
`,
    'utf8',
  );
  await chmod(executablePath, 0o755);
};

const spawnScript = async (scriptPath: string, env: Record<string, string>): Promise<number> => {
  const process = Bun.spawn(['/usr/bin/bash', scriptPath], {
    cwd: repoRoot,
    env,
    stdout: 'ignore',
    stderr: 'ignore',
  });

  return await process.exited;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('backend harness entrypoints', () => {
  test('backend-stack-start clears stale seed manifest before startup work begins', async () => {
    const tempRoot = rememberTempRoot(await mkdtemp(join(tmpdir(), 'betterchat-harness-start-')));
    const binDir = join(tempRoot, 'bin');
    const manifestPath = join(tempRoot, 'betterchat-seed-manifest.json');

    await mkdir(binDir, { recursive: true });
    await writeFile(manifestPath, '{"stale":true}\n', 'utf8');
    await installExecutable(binDir, 'systemctl', 'exit 0');
    await installExecutable(binDir, 'podman', 'exit 0');
    await installExecutable(
      binDir,
      'docker',
      `
if [ "\${1:-}" != "compose" ]; then
  exit 97
fi

if [ -e "${manifestPath}" ]; then
  exit 17
fi

exit 23
`,
    );
    await installExecutable(binDir, 'bun', 'exit 99');

    const exitCode = await spawnScript(backendStackStartScript, {
      ...process.env,
      COMPOSE_TOOL: 'docker compose',
      PATH: `${binDir}:${process.env.PATH || ''}`,
      BETTERCHAT_TEST_SEED_MANIFEST_PATH: manifestPath,
    });

    expect(exitCode).toBe(23);
    expect(await fileExists(manifestPath)).toBe(false);
  });

  test('backend-integration-test clears stale seed manifest before wait/seed commands', async () => {
    const tempRoot = rememberTempRoot(await mkdtemp(join(tmpdir(), 'betterchat-harness-test-')));
    const binDir = join(tempRoot, 'bin');
    const manifestPath = join(tempRoot, 'betterchat-seed-manifest.json');

    await mkdir(binDir, { recursive: true });
    await writeFile(manifestPath, '{"stale":true}\n', 'utf8');
    await installExecutable(binDir, 'bun', 'exit 41');

    const exitCode = await spawnScript(backendIntegrationTestScript, {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ''}`,
      BETTERCHAT_TEST_SEED_MANIFEST_PATH: manifestPath,
    });

    expect(exitCode).toBe(41);
    expect(await fileExists(manifestPath)).toBe(false);
  });
});
