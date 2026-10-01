export const styles = `
/* Keep this additive footer contribution on its own row, including in the rail.
   Scope wrapping to the notice's immediate slot container, never shell class names. */
div:has(> .chatgpt-plan-sidebar) { flex-wrap: wrap; }
.chatgpt-plan-sidebar { flex: 1 0 100%; min-width: 0; box-sizing: border-box; padding: 10px 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.chatgpt-plan-sidebar p { margin: 0; }
.chatgpt-plan-sidebar-label { color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.chatgpt-plan-sidebar[data-reconnect="true"] .chatgpt-plan-sidebar-label { color: var(--dsw-alias-state-warn-primary); }
.chatgpt-plan-sidebar a { color: var(--dsw-alias-label-secondary); text-decoration: underline; text-underline-offset: 3px; }
.chatgpt-plan-sidebar a:hover { color: var(--dsw-alias-label-primary); }
.chatgpt-plan-sidebar a:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; border-radius: 3px; }
.chatgpt-plan-sidebar[data-wide="false"] { display: flex; justify-content: center; padding: 6px 0; }
.chatgpt-plan-sidebar-compact { display: inline-flex; align-items: center; justify-content: center; width: 32px; min-height: 32px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; font-size: 10px; }
.chatgpt-plan-sidebar[data-reconnect="true"] .chatgpt-plan-sidebar-compact { color: var(--dsw-alias-state-warn-primary); }

.chatgpt-plan-panel { border: 1px solid var(--border-color, #7775); border-radius: 12px; padding: 20px; margin: 20px 0; color: inherit; font: inherit; }
.chatgpt-plan-panel header { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
.chatgpt-plan-panel h3, .chatgpt-plan-panel h4 { margin: 0 0 8px; }
.chatgpt-plan-panel p { margin: 8px 0 12px; line-height: 1.5; }
.chatgpt-plan-state { border: 1px solid #7775; border-radius: 99px; padding: 4px 10px; font-size: 12px; white-space: nowrap; }
.chatgpt-plan-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
.chatgpt-plan-panel button { border: 1px solid #7777; background: transparent; color: inherit; font: inherit; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
.chatgpt-plan-panel button:disabled { opacity: .5; cursor: default; }
.chatgpt-plan-panel button:focus-visible, .chatgpt-plan-panel a:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, currentColor); outline-offset: 3px; }
.chatgpt-plan-catalog { border-top: 1px solid #7773; border-bottom: 1px solid #7773; padding: 16px 0; margin: 16px 0; }
.chatgpt-plan-catalog-details { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 12px 0; font-size: 12px; }
.chatgpt-plan-catalog-details dt { font-weight: 600; }
.chatgpt-plan-catalog-details dd { margin: 4px 0 0; overflow-wrap: anywhere; }
.chatgpt-plan-panel .chatgpt-plan-continue { background: #101010; color: #fff; border-color: #101010; }
.chatgpt-plan-panel a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
.chatgpt-plan-panel ul { list-style: none; padding: 0; }
.chatgpt-plan-panel li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 8px 0; border-bottom: 1px solid #7773; }
.chatgpt-plan-panel li span, .chatgpt-plan-panel small { font-size: 12px; opacity: .75; }
.chatgpt-plan-panel small { flex-basis: 100%; }
.chatgpt-plan-panel footer { border-top: 1px solid #7773; padding-top: 12px; font-size: 12px; opacity: .8; }
.chatgpt-plan-notice { border-left: 3px solid #b58b34; padding-left: 10px; }
`;
