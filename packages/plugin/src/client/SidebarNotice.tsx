import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type { PanelInjected } from './Panel.tsx';
import { en } from './locales.ts';
import { CHATGPT_USAGE_URL } from './usage.ts';

export type SidebarNoticeInjected = Pick<PanelInjected, 'hooks'>;
type SidebarNoticeProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<SidebarNoticeInjected>;

export function ChatGPTSidebarNotice(props: SidebarNoticeProps) {
  const status = props.useConnection(state => state.status);
  if (status?.state !== 'connected' && status?.state !== 'needs-reconnect') return null;
  const reconnect = status.state === 'needs-reconnect';
  const label = reconnect ? en.sidebarReconnect : en.sidebarConnected;
  const description = reconnect ? `${label}. ${en.sidebarReconnectHint}` : `${label}. ${en.sidebarUsage}`;
  const icon = <span className="chatgpt-plan-sidebar-icon" aria-hidden="true">
    <svg width={props.wide ? 16 : 18} height={props.wide ? 16 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path d="M20 11.5a8 8 0 0 1-8 8H4l1.8-3.6A8 8 0 1 1 20 11.5Z" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  </span>;
  return <section className="chatgpt-plan-sidebar" data-wide={props.wide} data-reconnect={reconnect} aria-label={label}>
    {props.wide ? <>
      {icon}
      <div className="chatgpt-plan-sidebar-copy">
        <p className="chatgpt-plan-sidebar-label">{label}</p>
        {reconnect ? <p className="chatgpt-plan-sidebar-hint">{en.sidebarReconnectHint}</p>
          : <a className="chatgpt-plan-sidebar-usage" href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer">{en.sidebarUsage}</a>}
      </div>
    </> : reconnect ? <span className="chatgpt-plan-sidebar-compact" title={description} aria-label={description}>{icon}</span>
      : <a className="chatgpt-plan-sidebar-compact" href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" title={description} aria-label={description}>{icon}</a>}
  </section>;
}
