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
  updatingModels?: boolean;
  catalogMessage?: string;
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

function catalogTime(value: number | undefined) {
  const date = value === undefined ? undefined : new Date(value);
  if (!date || !Number.isFinite(date.getTime())) return en.catalogNoDate;
  return <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>;
}

export function ConnectionPanel(props: PanelProps) {
  const state = props.useConnection(state => state);
  const status = state.status;
  const catalog = status?.catalog;
  const updatingModels = Boolean(state.updatingModels || catalog?.refreshing);
  const connected = status?.state === 'connected';
  const authorizing = status?.state === 'authorizing' || Boolean(state.authorizationUrl);
  const label = !status ? en.loading : ({ disconnected: en.disconnected, connected: en.connected, authorizing: en.authorizing, 'needs-reconnect': en.needsReconnect })[status.state];
  return <section className="chatgpt-plan-panel" aria-label={en.title}>
    <header><div><h3>{en.title}</h3><p>{en.subtitle}</p></div><span className="chatgpt-plan-state">{label}</span></header>
    {status?.account && <p><strong>{status.account.label}</strong></p>}
    {!props.local && <p role="alert">{en.localOnly}</p>}
    <div className="chatgpt-plan-actions">
      {connected ? <button type="button" disabled={state.busy} onClick={props.disconnect}>{en.disconnect}</button> : <>
        <button type="button" className="chatgpt-plan-continue" disabled={!props.local || state.busy} onClick={() => props.connect(false)}>{status?.account ? en.reconnect : en.connect}</button>
        {status?.account && <button type="button" disabled={!props.local || state.busy} onClick={() => props.connect(true)}>{en.changeAccount}</button>}
      </>}
      {authorizing && <button type="button" onClick={props.cancel}>{en.cancel}</button>}
    </div>
    {state.authorizationUrl && <p><a href={state.authorizationUrl} target="_blank" rel="noopener noreferrer">{en.openSignIn}</a></p>}
    {state.message && <p role="status">{state.message}</p>}
    {status?.warning && <p role="alert">{status.warning}</p>}
    <section className="chatgpt-plan-catalog" aria-label={en.catalogTitle}>
      <h4>{en.catalogTitle}</h4>
      <div role="status" aria-live="polite" aria-atomic="true">
        {catalog ? <>
          <p><span className="chatgpt-plan-state">{en.catalogSource}</span> <span>{en.catalogLoadedFrom[catalog.loadedFrom]}</span></p>
          <dl className="chatgpt-plan-catalog-details">
            <div><dt>{en.catalogRevision}</dt><dd><code title={catalog.revision}>{catalog.revision.slice(0, 12)}</code></dd></div>
            <div><dt>{en.catalogLastChecked}</dt><dd>{catalogTime(catalog.lastCheckedAt)}</dd></div>
            <div><dt>{en.catalogLastUpdated}</dt><dd>{catalogTime(catalog.lastUpdatedAt)}</dd></div>
          </dl>
          {catalog.warning && <p className="chatgpt-plan-notice"><strong>{en.catalogWarning}</strong> {catalog.warning}</p>}
        </> : <p>{en.catalogUnavailable}</p>}
        {state.catalogMessage && <p className="chatgpt-plan-notice"><strong>{en.catalogWarning}</strong> {state.catalogMessage}</p>}
        {updatingModels && <p>{en.catalogUpdating}</p>}
      </div>
      {catalog && <p><a href={catalog.sourceUrl} target="_blank" rel="noopener noreferrer">{en.catalogSourceLink}</a></p>}
      <p>{en.catalogHint}</p>
      <button type="button" disabled={!status || state.busy || updatingModels} aria-busy={updatingModels} onClick={props.refresh}>{en.refresh}</button>
    </section>
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
