import { createHash, randomUUID } from 'node:crypto';
import { renameSync } from 'node:fs';
import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { CatalogInfo } from './contracts.ts';
import { PlanError } from './errors.ts';
import { CatalogModels, parsePiCatalog, PI_CATALOG_MAX_BYTES, PI_CATALOG_PROVIDER, PI_CATALOG_URL, type CatalogModel } from './models.ts';
import { PI_CATALOG_SNAPSHOT } from './pi-catalog.generated.ts';

export { PI_CATALOG_URL } from './models.ts';

export interface CatalogSource {
  initialize(): Promise<void>;
  models(): CatalogModel[];
  info(): CatalogInfo;
  refresh(signal?: AbortSignal): Promise<CatalogModel[]>;
  dispose(): void;
}

const Timestamp = z.number().int().nonnegative();
const EntityTag = z.string().max(1024).regex(/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/);
const CacheFile = z.object({
  schemaVersion: z.literal(1),
  url: z.literal(PI_CATALOG_URL),
  provider: z.literal(PI_CATALOG_PROVIDER),
  models: CatalogModels,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  lastCheckedAt: Timestamp,
  lastUpdatedAt: Timestamp,
  etag: EntityTag.optional(),
}).strict();
type CacheFile = z.infer<typeof CacheFile>;

function revision(models: CatalogModel[]): string {
  return createHash('sha256').update(JSON.stringify(models)).digest('hex');
}

function aborted(): PlanError {
  return new PlanError('ABORTED', 'The catalog operation was cancelled.');
}

/** Cancellation only stops this wait, never the shared operation. */
function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(aborted());
  }
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(aborted()); };
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', cancel); resolve(value); },
      error => { signal.removeEventListener('abort', cancel); reject(error); },
    );
  });
}

async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > PI_CATALOG_MAX_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new PlanError('CATALOG_TOO_LARGE', 'Pi returned a model catalog exceeding the 2 MiB limit.');
  }
  if (!response.body) throw new PlanError('INVALID_CATALOG', 'Pi returned an empty catalog response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let finished = false;
  try {
    for (;;) {
      const chunk = await waitFor(reader.read(), signal);
      if (chunk.done) { finished = true; break; }
      size += chunk.value.byteLength;
      if (size > PI_CATALOG_MAX_BYTES) throw new PlanError('CATALOG_TOO_LARGE', 'Pi returned a model catalog exceeding the 2 MiB limit.');
      chunks.push(chunk.value);
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown;
    } catch {
      throw new PlanError('INVALID_CATALOG', 'Pi returned invalid JSON for its model catalog.');
    }
  } finally {
    if (!finished) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class PiCatalog implements CatalogSource {
  private readonly transport: typeof fetch;
  private readonly onChanged: (() => void) | undefined;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly lifetime = new AbortController();
  private currentModels: CatalogModel[];
  private metadata: CatalogInfo;
  private initialization: Promise<void> | undefined;
  private refreshJob: Promise<CatalogModel[]> | undefined;
  private etag: string | undefined;
  private validatedBody = false;
  private disposed = false;

  constructor(private readonly cacheFile: string, options: {
    transport?: typeof fetch;
    onChanged?: () => void;
    now?: () => number;
    timeoutMs?: number;
    fallback?: { models: unknown; generatedAt: number };
  } = {}) {
    this.transport = options.transport ?? fetch;
    this.onChanged = options.onChanged;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 4000;
    const fallback = options.fallback ?? PI_CATALOG_SNAPSHOT;
    this.currentModels = parsePiCatalog(fallback.models);
    this.metadata = {
      source: 'pi', sourceUrl: PI_CATALOG_URL, loadedFrom: 'bundled',
      revision: revision(this.currentModels), lastUpdatedAt: Timestamp.parse(fallback.generatedAt), refreshing: false,
    };
  }

  initialize(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.initialization ??= this.loadCache();
  }

  models(): CatalogModel[] { return structuredClone(this.currentModels); }
  info(): CatalogInfo { return { ...this.metadata }; }

  refresh(signal?: AbortSignal): Promise<CatalogModel[]> {
    if (this.disposed || signal?.aborted) return Promise.reject(aborted());
    if (!this.refreshJob) {
      const job = this.refreshOnce().finally(() => { if (this.refreshJob === job) this.refreshJob = undefined; });
      this.refreshJob = job;
    }
    const waiting = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    return waitFor(this.refreshJob, waiting).then(models => structuredClone(models));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.metadata = { ...this.metadata, refreshing: false };
    this.lifetime.abort();
  }

  private ensureActive(): void {
    if (this.disposed) throw aborted();
  }

  private notify(): void {
    if (this.disposed) return;
    try { this.onChanged?.(); } catch { /* Observers cannot invalidate a catalog transaction. */ }
  }

  private async loadCache(): Promise<void> {
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(this.cacheFile, 'r');
      if ((await file.stat()).size > PI_CATALOG_MAX_BYTES) throw new Error('Oversized cache');
      const text = await file.readFile({ encoding: 'utf8', signal: this.lifetime.signal });
      if (Buffer.byteLength(text, 'utf8') > PI_CATALOG_MAX_BYTES) throw new Error('Oversized cache');
      const cached = CacheFile.parse(JSON.parse(text));
      if (revision(cached.models) !== cached.revision) throw new Error('Invalid cache revision');
      if (this.disposed) return;
      this.currentModels = cached.models;
      this.etag = cached.etag;
      this.validatedBody = true;
      this.metadata = {
        source: 'pi', sourceUrl: PI_CATALOG_URL, loadedFrom: 'cache', revision: cached.revision,
        lastCheckedAt: cached.lastCheckedAt, lastUpdatedAt: cached.lastUpdatedAt, refreshing: false,
      };
    } catch (error) {
      if (!this.disposed && (error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.metadata = { ...this.metadata, warning: 'The Pi catalog cache could not be validated. The bundled snapshot is in use.' };
      }
    } finally {
      await file?.close().catch(() => {});
    }
  }

  private async refreshOnce(): Promise<CatalogModel[]> {
    await this.initialize();
    this.ensureActive();
    this.metadata = { ...this.metadata, refreshing: true };
    this.notify();
    const request = new AbortController();
    const signal = AbortSignal.any([request.signal, this.lifetime.signal]);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; request.abort(); }, this.timeoutMs);
    try {
      this.ensureActive();
      const headers = new Headers({ Accept: 'application/json', 'User-Agent': 'dsh-chatgpt-plan/pi-catalog' });
      if (this.validatedBody && this.etag) headers.set('If-None-Match', this.etag);
      const response = await waitFor(this.transport(PI_CATALOG_URL, {
        method: 'GET', headers, redirect: 'error', credentials: 'omit', signal,
      }).then(response => {
        if (signal.aborted) {
          void response.body?.cancel().catch(() => {});
          throw aborted();
        }
        return response;
      }), signal);
      let models: CatalogModel[];
      if (response.status === 304 && this.validatedBody) {
        models = this.currentModels;
      } else if (response.status === 200) {
        models = parsePiCatalog(await readBody(response, signal));
      } else {
        void response.body?.cancel().catch(() => {});
        throw new PlanError('CATALOG_HTTP', response.status === 304
          ? 'Pi returned an unchanged catalog without a validated previous body.'
          : `Pi catalog refresh failed with HTTP ${response.status}.`);
      }
      clearTimeout(timeout);
      this.ensureActive();
      const etagResult = EntityTag.safeParse(response.headers.get('etag'));
      const etag = etagResult.success ? etagResult.data : response.status === 304 ? this.etag : undefined;
      const checkedAt = this.now();
      const nextRevision = revision(models);
      const cached: CacheFile = {
        schemaVersion: 1, url: PI_CATALOG_URL, provider: PI_CATALOG_PROVIDER,
        models, revision: nextRevision, lastCheckedAt: checkedAt,
        lastUpdatedAt: nextRevision === this.metadata.revision ? this.metadata.lastUpdatedAt ?? checkedAt : checkedAt,
        ...(etag !== undefined ? { etag } : {}),
      };
      await this.persist(cached);
      this.ensureActive();
      this.currentModels = models;
      this.etag = etag;
      this.validatedBody = true;
      this.metadata = {
        source: 'pi', sourceUrl: PI_CATALOG_URL, loadedFrom: 'remote', revision: nextRevision,
        lastCheckedAt: checkedAt, lastUpdatedAt: cached.lastUpdatedAt, refreshing: true,
      };
      return this.models();
    } catch (error) {
      if (this.disposed) throw aborted();
      const safe = timedOut
        ? new PlanError('TIMEOUT', 'Pi catalog refresh timed out. The previous catalog is still in use.')
        : error instanceof PlanError ? error
          : new PlanError('CATALOG_TRANSPORT', 'Pi could not be reached. The previous catalog is still in use.');
      this.metadata = { ...this.metadata, lastCheckedAt: this.now(), warning: safe.message };
      throw safe;
    } finally {
      clearTimeout(timeout);
      if (!this.disposed) {
        this.metadata = { ...this.metadata, refreshing: false };
        this.notify();
      }
    }
  }

  private async persist(cached: CacheFile): Promise<void> {
    const temporary = `${this.cacheFile}.${randomUUID()}.tmp`;
    try {
      this.ensureActive();
      await mkdir(dirname(this.cacheFile), { recursive: true });
      this.ensureActive();
      await writeFile(temporary, JSON.stringify(cached), { encoding: 'utf8', flag: 'wx', mode: 0o600, signal: this.lifetime.signal });
      this.ensureActive();
      // A synchronous atomic promotion cannot interleave with dispose and a replacement source.
      renameSync(temporary, this.cacheFile);
    } catch {
      this.ensureActive();
      throw new PlanError('CATALOG_CACHE', 'The Pi catalog could not be saved. The previous catalog is still in use.');
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
}
