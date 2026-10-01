import OpenAI from 'openai';
import type { AttachmentStore, FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { LlmAdapter, LlmError, attributionHeaders, type GenerateOptions, type ImageAttachmentAccessResolver, type LlmResolvedModelInfo, type ProviderRequestId, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { API_RESOURCE } from './oauth.ts';
import { PlanError, providerFailure, safeError, throwIfAborted } from './errors.ts';
import { resolvedModel } from './models.ts';
import { RequestBuilder, type RequestImagePolicy } from './request.ts';
import { ResponseStreamTranslator } from './response-stream.ts';
import type { ActiveGrant, SessionManager } from './session.ts';

export class ChatGPTPlanAdapter extends LlmAdapter {
  private readonly builder: RequestBuilder;
  constructor(
    private readonly manager: SessionManager,
    attachments: Pick<AttachmentStore, 'readImageRequest' | 'imageLimits'>,
    imageAccess?: ImageAttachmentAccessResolver,
    fileText?: (ref: FileAttachmentRef) => string,
    private readonly transport: typeof fetch = fetch,
    imagePolicy?: Readonly<RequestImagePolicy>,
  ) { super(); this.builder = new RequestBuilder(attachments, imageAccess, fileText, imagePolicy); }

  override providerInfo(provider: string) { return { id: provider, name: 'ChatGPT Plan' }; }
  override async listModels(_provider: string) { return this.manager.models().filter(model => model.available).map(resolvedModel); }

  override async resolveModel(_provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    try {
      throwIfAborted(signal);
      const found = this.manager.models().find(candidate => candidate.id === model);
      if (!found) throw new PlanError('MODEL_UNAVAILABLE', 'This model is not selectable from the current Pi catalog for this profile. Connect the profile if needed, update models, and select a listed model. No model has been substituted.');
      return resolvedModel(found);
    } catch (error) { const failure = safeError(error); throw new LlmError(failure.message, failure.code); }
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal) {
    const metadata = await this.resolveModel(provider, model, signal);
    try {
      const grant = await this.manager.activeGrant(signal);
      return { model: metadata, stream: (options: GenerateOptions) => this.dispatch(options, metadata, grant.generation) };
    } catch (error) { const failure = safeError(error); throw new LlmError(failure.message, failure.code); }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    try { yield* this.dispatch(options, await this.resolveModel(options.provider, options.model, options.signal)); }
    catch (error) { yield terminalFailure(safeError(error), options.signal); }
  }

  private async *dispatch(options: GenerateOptions, model: LlmResolvedModelInfo, expectedGeneration?: number): AsyncIterable<StreamChunk> {
    const call = this.manager.requestSignal(options.signal);
    let grant: ActiveGrant | undefined;
    let requestId: string | undefined;
    try {
      grant = await this.manager.activeGrant(call.signal);
      if (expectedGeneration !== undefined && grant.generation !== expectedGeneration) throw new PlanError('ACCOUNT_CHANGED', 'The account changed after preparing this request. Start a new request.');
      const request = await this.builder.build({ ...options, signal: call.signal }, model, grant);
      throwIfAborted(call.signal);
      const client = new OpenAI({ apiKey: grant.tokens.accessToken, baseURL: API_RESOURCE, maxRetries: 0, timeout: 120_000, defaultHeaders: attributionHeaders(), fetch: this.transport, fetchOptions: { redirect: 'error' } });
      const { data, response } = await client.responses.create(request.body, { signal: call.signal }).withResponse();
      const header = response.headers.get('x-request-id');
      requestId = header && /^[a-zA-Z0-9_.-]{1,200}$/.test(header) ? header : undefined;
      const translator = new ResponseStreamTranslator(request.toolNames, { kind: 'chatgpt-plan-v1', clientId: grant.registration.clientId, model: options.model });
      for await (const event of data) {
        throwIfAborted(call.signal);
        yield* translator.push(event);
        if (translator.terminal) break;
      }
      if (!translator.terminal) throw new PlanError('INCOMPLETE_RESPONSE', 'The stream ended before response.completed. Partial tool calls will not execute.');
    } catch (error) {
      const failure = providerFailure(error, requestId);
      if (grant && ['AUTH', 'INSUFFICIENT_SCOPE'].includes(failure.code)) await this.manager.invalidate(grant.generation, failure);
      yield terminalFailure(failure, call.signal);
    } finally { call.release(); }
  }
}

function terminalFailure(error: PlanError, signal?: AbortSignal): StreamChunk {
  return { type: 'finish', reason: {
    kind: signal?.aborted || error.code === 'ABORTED' ? 'aborted' : 'error',
    failure: { code: error.code, message: error.message, ...(error.status ? { status: error.status } : {}), ...(error.providerRetryAfterMs ? { providerRetryAfterMs: error.providerRetryAfterMs } : {}), ...(error.requestId ? { requestId: error.requestId as ProviderRequestId } : {}), ...(error.offloadImages ? { offloadImages: error.offloadImages } : {}) },
  } };
}
