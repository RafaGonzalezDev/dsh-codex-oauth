import OpenAI from 'openai';
import { LlmError } from '@deepseek-ai/dsh-llm';

/** Errors carry safe messages; raw token-endpoint and SDK errors never cross RPC. */
export class PlanError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
    public readonly providerRetryAfterMs?: number,
    public readonly offloadImages?: number,
  ) {
    super(message);
    this.name = 'PlanError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PlanError('ABORTED', 'The operation was cancelled.');
}

export function safeError(error: unknown): PlanError {
  if (error instanceof PlanError) return error;
  if (error instanceof Error && /Abort/.test(error.name)) return new PlanError('ABORTED', 'The operation was cancelled.');
  if (error instanceof Error && /Timeout/.test(error.name)) return new PlanError('TIMEOUT', 'The operation timed out. Please retry.');
  return new PlanError('TRANSPORT', 'The service could not be reached. Please retry.');
}

export function retryAfterMs(headers: Headers): number | undefined {
  const milliseconds = headers.get('retry-after-ms');
  const delay = milliseconds !== null ? Number(milliseconds) : (() => {
    const value = headers.get('retry-after');
    if (value === null) return undefined;
    return /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  })();
  return delay !== undefined && Number.isFinite(delay) && delay > 0 && delay <= 86_400_000 ? delay : undefined;
}

export function classifyProviderError(status: number | undefined, code: string, requestId?: string, delay?: number): PlanError {
  const diagnostic = /^[a-zA-Z0-9_.-]{1,120}$/.test(code) ? ` (OpenAI code: ${code}).` : '';
  const failure = (kind: string, message: string) => new PlanError(kind, message + diagnostic, status, requestId, delay);
  if (/quota|usage_limit|plan.*limit|budget|credits|balance/.test(code)) {
    return failure('QUOTA', 'The ChatGPT usage limit for this app was reached. Review ChatGPT Settings → Usage.');
  }
  if (/insufficient_scope|plan_use_not_enabled|chatpass_v2_scope_not_authorized|chatpass_v2_invalid_authorization_context/.test(code)) {
    return failure('INSUFFICIENT_SCOPE', 'ChatGPT plan usage permission was not accepted. Reconnect and check the client and grant configuration.');
  }
  if (/context.*(exceed|overflow|limit)/.test(code)) return failure('CONTEXT_WINDOW_EXCEEDED', 'The request exceeds the model context window.');
  if (status === 401 || code === 'subscription_sharing_invalid_user') return failure('AUTH', 'The ChatGPT session was not accepted. Reconnect this profile.');
  if (code === 'subscription_sharing_route_not_supported') return failure('UNSUPPORTED_REQUEST', 'OpenAI does not support this request route. Update the plugin integration.');
  if (status === 403 || code === 'subscription_sharing_user_not_eligible') return failure('INELIGIBLE', 'ChatGPT plan usage is restricted for this account, workspace, model, or serving region.');
  if (status === 429 || code === 'rate_limit_exceeded') return failure('RATE_LIMIT', 'The provider rate limit was reached. Retry later.');
  if ((status !== undefined && status >= 500) || ['server_error', 'subscription_sharing_usage_unavailable', 'subscription_sharing_user_unavailable'].includes(code)) return failure('SERVER', 'OpenAI is temporarily unavailable. Retry later.');
  return failure('UNSUPPORTED_REQUEST', 'OpenAI rejected the request or an unsupported capability. Review the plugin restrictions.');
}

/** Safe SDK classification for inference failures. */
export function providerFailure(error: unknown, requestId?: string): PlanError {
  if (error instanceof PlanError) return error;
  if (error instanceof LlmError) return new PlanError(error.code, error.message, error.failure.status, error.failure.requestId, error.failure.providerRetryAfterMs, error.failure.offloadImages);
  if (error instanceof OpenAI.APIUserAbortError) return new PlanError('ABORTED', 'The operation was cancelled.');
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new PlanError('TIMEOUT', 'The OpenAI request timed out. Retry later.');
  if (error instanceof OpenAI.APIConnectionError) return new PlanError('TRANSPORT', 'OpenAI could not be reached. Retry later.');
  if (error instanceof OpenAI.APIError) {
    const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
    const detail = isRecord(error.error) && isRecord(error.error.detail) ? error.error.detail : undefined;
    const code = error.code ?? (typeof detail?.code === 'string' ? detail.code : '');
    return classifyProviderError(error.status, code, requestId ?? (error.requestID && /^[a-zA-Z0-9_.-]{1,200}$/.test(error.requestID) ? error.requestID : undefined), error.headers ? retryAfterMs(error.headers) : undefined);
  }
  return safeError(error);
}
