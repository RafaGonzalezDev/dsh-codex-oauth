import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import { ChatGPTLogo } from './ChatGPTLogo.tsx';
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
  const description = reconnect ? `${label}. ${en.sidebarReconnectHint}` : `${label}. ${en.sidebarUsage}. ${en.sidebarNewTab}`;
  const icon = <span className="chatgpt-plan-sidebar-icon" aria-hidden="true">
    <ChatGPTLogo size={props.wide ? 16 : 18} />
  </span>;
  return <section className="chatgpt-plan-sidebar" data-wide={props.wide} data-reconnect={reconnect} aria-label={description} title={description}>
    {props.wide ? <>
      {icon}
      {reconnect ? <p className="chatgpt-plan-sidebar-label" title={description} aria-label={description}>{label}</p>
        : <a className="chatgpt-plan-sidebar-label" href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" title={description} aria-label={description}>{label}</a>}
    </> : reconnect ? <span className="chatgpt-plan-sidebar-compact" title={description} aria-label={description}>{icon}</span>
      : <a className="chatgpt-plan-sidebar-compact" href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" title={description} aria-label={description}>{icon}</a>}
  </section>;
}
