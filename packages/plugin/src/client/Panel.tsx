import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client';
import type { ConnectionStatus } from '../contracts.ts';
import { en } from './locales.ts';
import { CHATGPT_USAGE_URL } from './usage.ts';

export interface PanelState {
  status?: ConnectionStatus;
  busy: boolean;
  message?: string;
  authorizationUrl?: string;
}
export interface PanelInjected {
  hooks: { connection: HostObservable<PanelState> };
  local: boolean;
  connect(changeAccount: boolean): void;
  cancel(): void;
  disconnect(): void;
  refresh(): void;
}
type PanelProps = PropsRuntime<'settings.models.footer'> & InjectFace<PanelInjected>;

export function ConnectionPanel(props: PanelProps) {
  const state = props.useConnection(state => state);
  const status = state.status;
  const connected = status?.state === 'connected';
  const authorizing = status?.state === 'authorizing' || Boolean(state.authorizationUrl);
  const label = !status ? en.loading : ({ disconnected: en.disconnected, connected: en.connected, authorizing: en.authorizing, 'needs-reconnect': en.needsReconnect })[status.state];
  return <section className="chatgpt-plan-panel" aria-label={en.title}>
    <header><div><h3>{en.title}</h3><p>{en.subtitle}</p></div><span className="chatgpt-plan-state">{label}</span></header>
    {status?.account && <p><strong>{status.account.label}</strong></p>}
    {!props.local && <p role="alert">{en.localOnly}</p>}
    <div className="chatgpt-plan-actions">
      {connected ? <>
        <button disabled={state.busy} onClick={props.refresh}>{en.refresh}</button>
        <button disabled={state.busy} onClick={props.disconnect}>{en.disconnect}</button>
      </> : <>
        <button className="chatgpt-plan-continue" disabled={!props.local || state.busy} onClick={() => props.connect(false)}>{status?.account ? en.reconnect : en.connect}</button>
        {status?.account && <button disabled={!props.local || state.busy} onClick={() => props.connect(true)}>{en.changeAccount}</button>}
      </>}
      {authorizing && <button onClick={props.cancel}>{en.cancel}</button>}
    </div>
    {state.authorizationUrl && <p><a href={state.authorizationUrl} target="_blank" rel="noopener noreferrer">{en.openSignIn}</a></p>}
    {state.message && <p role="status">{state.message}</p>}
    {status?.warning && <p role="alert">{status.warning}</p>}
    {connected && <>
      {!status.preferredModelAvailable && <p className="chatgpt-plan-notice">{en.unavailable}</p>}
      {!status.models.some(model => model.available) && <p>{en.emptyCatalog}</p>}
      <h4>{en.models}</h4>
      <ul>{status.models.map(model => <li key={model.id}><strong>{model.name}</strong> <code>{model.id}</code>
        <span>{model.available ? model.inputModalities.join(' + ') : en.unsupported}</span>
        {model.warning && <small>{model.warning}</small>}
      </li>)}</ul>
      <p>{en.selectHint}</p>
    </>}
    <footer><p>{en.quotaHint}</p><a href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer">{en.usage}</a></footer>
  </section>;
}
