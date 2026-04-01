#!/usr/bin/env bun
import { $ } from 'bun';

console.log('--- clean ---');
await $`rm -rf dist/ && mkdir -p dist/`;

console.log('--- build frontend ---');
await $`bun run build:web`.env({
  ...process.env,
  VITE_BETTERCHAT_API_MODE: 'api',
});

console.log('--- bundle backend CLI ---');
await $`bun build apps/backend/src/cli.ts --target bun --outdir dist/ --sourcemap=external`;

const cli = await Bun.file('dist/cli.js').text();
if (!cli.startsWith('#!')) {
  await Bun.write('dist/cli.js', '#!/usr/bin/env bun\n' + cli);
}
await $`chmod +x dist/cli.js`;

console.log('--- copy frontend assets ---');
await $`cp -r apps/web/dist/. dist/public/`;

console.log('--- generate dist/package.json ---');
const rootPkg = await Bun.file('package.json').json();
await Bun.write(
  'dist/package.json',
  JSON.stringify(
    {
      name: '@clouder0/betterchat',
      version: rootPkg.version,
      description: 'A modern web client for Rocket.Chat',
      license: 'MIT',
      bin: { betterchat: './cli.js' },
      files: ['cli.js', 'cli.js.map', 'public/', 'README.md'],
      engines: { bun: '>=1.3' },
      keywords: ['rocketchat', 'chat', 'client'],
      repository: { type: 'git', url: 'https://github.com/Clouder0/betterchat.git' },
    },
    null,
    2,
  ) + '\n',
);

console.log('--- copy README ---');
await $`cp README.md dist/README.md`;

console.log('--- done ---');
await $`ls -lh dist/`;
