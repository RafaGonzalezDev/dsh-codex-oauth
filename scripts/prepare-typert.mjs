import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The rc.2 analyzer recognizes protocol symbols only inside registered projects.
// Give it an analysis-only view of the exact installed public declarations.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('@deepseek-ai/dsh-typert-protocol/package.json'));
const target = resolve(root, 'packages/.build/typert-protocol');
await mkdir(target, { recursive: true });
await mkdir(resolve(target, 'src'), { recursive: true });
for (const name of await readdir(resolve(source, 'lib/types'))) {
  if (!name.endsWith('.d.ts')) continue;
  await writeFile(resolve(target, 'src', name.replace('.d.ts', '.ts')),
    await readFile(resolve(source, 'lib/types', name)));
}
await writeFile(resolve(target, 'package.json'), JSON.stringify({
  name: '@deepseek-ai/dsh-typert-protocol', private: true,
  exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } },
}, null, 2) + '\n');
await writeFile(resolve(target, 'tsconfig.json'), JSON.stringify({
  extends: '../../../tsconfig.base.json', compilerOptions: { composite: true }, files: [],
}, null, 2) + '\n');
