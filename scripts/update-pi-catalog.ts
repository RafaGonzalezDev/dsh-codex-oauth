import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parsePiCatalog, PiCatalogBody, PI_CATALOG_MAX_BYTES, PI_CATALOG_URL } from '../packages/plugin/src/models.ts';

const arguments_ = process.argv.slice(2);
if (arguments_.some(value => value !== '--check') || arguments_.length > 1) {
  throw new Error('Usage: node --import tsx scripts/update-pi-catalog.ts [--check]');
}

const response = await fetch(PI_CATALOG_URL, {
  method: 'GET',
  headers: { Accept: 'application/json', 'User-Agent': 'dsh-chatgpt-plan/pi-catalog' },
  credentials: 'omit',
  redirect: 'error',
  signal: AbortSignal.timeout(4000),
});
if (response.status !== 200) throw new Error(`Pi catalog request failed with HTTP ${response.status}.`);
if (Number(response.headers.get('content-length')) > PI_CATALOG_MAX_BYTES) {
  await response.body?.cancel();
  throw new Error('Pi catalog exceeds the 2 MiB limit.');
}
if (!response.body) throw new Error('Pi returned an empty response body.');
const reader = response.body.getReader();
const chunks: Uint8Array[] = [];
let size = 0;
try {
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > PI_CATALOG_MAX_BYTES) throw new Error('Pi catalog exceeds the 2 MiB limit.');
    chunks.push(chunk.value);
  }
} finally {
  await reader.cancel();
  reader.releaseLock();
}
const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
parsePiCatalog(body);
const models = PiCatalogBody.parse(body);
const output = new URL('../packages/plugin/src/pi-catalog.generated.ts', import.meta.url);

if (arguments_.includes('--check')) {
  const existing = await import(output.href) as { PI_CATALOG_SNAPSHOT: { models: unknown } };
  if (JSON.stringify(PiCatalogBody.parse(existing.PI_CATALOG_SNAPSHOT.models)) !== JSON.stringify(models)) {
    throw new Error('The bundled Pi catalog is out of date. Run scripts/update-pi-catalog.ts.');
  }
  console.log(`Pi catalog snapshot is current (${models.length} models).`);
} else {
  const snapshot = { generatedAt: Date.now(), models };
  const content = `// Generated from ${PI_CATALOG_URL} by scripts/update-pi-catalog.ts.\n`
    + '// Pi model metadata: MIT, Copyright (c) 2025 Mario Zechner. Do not edit manually.\n'
    + `export const PI_CATALOG_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)} as const;\n`;
  // Observe an existing snapshot before replacing it; no other repository files are written.
  await readFile(output, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; });
  await writeFile(output, content, 'utf8');
  console.log(`Updated ${fileURLToPath(output)} (${models.length} models).`);
}
