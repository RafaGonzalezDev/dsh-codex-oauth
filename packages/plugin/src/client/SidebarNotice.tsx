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
  return <section className="chatgpt-plan-sidebar" data-wide={props.wide} data-reconnect={reconnect} aria-label={label}>
    {props.wide ? <>
      <p className="chatgpt-plan-sidebar-label">{label}</p>
      {reconnect ? <p className="chatgpt-plan-sidebar-hint">{en.sidebarReconnectHint}</p>
        : <a href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer">{en.sidebarUsage}</a>}
    </> : reconnect ? <span className="chatgpt-plan-sidebar-compact" title={description} aria-label={description}>GPT</span>
      : <a className="chatgpt-plan-sidebar-compact" href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" title={description} aria-label={description}>GPT</a>}
  </section>;
}
