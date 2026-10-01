export const styles = `
.chatgpt-plan-panel { border: 1px solid var(--border-color, #7775); border-radius: 12px; padding: 20px; margin: 20px 0; color: inherit; font: inherit; }
.chatgpt-plan-panel header { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
.chatgpt-plan-panel h3, .chatgpt-plan-panel h4 { margin: 0 0 8px; }
.chatgpt-plan-panel p { margin: 8px 0 12px; line-height: 1.5; }
.chatgpt-plan-state { border: 1px solid #7775; border-radius: 99px; padding: 4px 10px; font-size: 12px; white-space: nowrap; }
.chatgpt-plan-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
.chatgpt-plan-panel button { border: 1px solid #7777; background: transparent; color: inherit; font: inherit; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
.chatgpt-plan-panel button:disabled { opacity: .5; cursor: default; }
.chatgpt-plan-panel .chatgpt-plan-continue { background: #101010; color: #fff; border-color: #101010; }
.chatgpt-plan-panel a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
.chatgpt-plan-panel ul { list-style: none; padding: 0; }
.chatgpt-plan-panel li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 8px 0; border-bottom: 1px solid #7773; }
.chatgpt-plan-panel li span, .chatgpt-plan-panel small { font-size: 12px; opacity: .75; }
.chatgpt-plan-panel small { flex-basis: 100%; }
.chatgpt-plan-panel footer { border-top: 1px solid #7773; padding-top: 12px; font-size: 12px; opacity: .8; }
.chatgpt-plan-notice { border-left: 3px solid #b58b34; padding-left: 10px; }
`;
