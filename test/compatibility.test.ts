import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { satisfies } = require('semver');
const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const plugin = JSON.parse(await readFile(new URL('../packages/plugin/package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const range = '>=0.2.0-rc.2 <0.3.0-0';
const isDsh = (name: string) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-');
const peers = Object.entries(plugin.peerDependencies).filter(([name]) => isDsh(name));

test('all DSH peers declare the bounded runtime range without widening development pins', () => {
  assert.equal(peers.length, 7);
  assert.equal(plugin.engines.dsh, range);
  for (const [name, requirement] of peers) assert.equal(requirement, range, name);
  for (const manifest of [root, plugin]) {
    for (const [name, requirement] of Object.entries(manifest.devDependencies)) {
      if (isDsh(name)) assert.equal(requirement, '0.2.0-rc.2', name);
    }
  }
});

// Match the installed DSH admission check, which opts into prerelease matching.
for (const [version, accepted] of [
  ['0.1.99', false], ['0.2.0-rc.1', false], ['0.2.0-rc.2', true],
  ['0.2.0-rc.3', true], ['0.2.0', true], ['0.2.1-rc.1', true],
  ['0.2.1', true], ['0.2.99', true], ['0.3.0-0', false],
  ['0.3.0-alpha.1', false], ['0.3.0-rc.1', false], ['0.3.0', false], ['1.0.0', false],
] as const) {
  test(`DSH runtime ${version} is ${accepted ? 'admitted' : 'excluded'} by every declared peer`, () => {
    for (const [name, requirement] of peers) {
      assert.equal(satisfies(version, requirement, { includePrerelease: true }), accepted, name);
    }
  });
}

test('workspace, distributable manifest and lockfile stay synchronized', () => {
  assert.equal(root.version, plugin.version);
  assert.equal(lock.version, root.version);
  assert.equal(lock.packages[''].version, root.version);
  assert.equal(lock.packages['packages/plugin'].version, plugin.version);
  assert.deepEqual(lock.packages['packages/plugin'].peerDependencies, plugin.peerDependencies);
  assert.deepEqual(lock.packages['packages/plugin'].engines, plugin.engines);
  assert.deepEqual(lock.packages[''].devDependencies, root.devDependencies);
});
