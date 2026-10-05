export const styles = `
/* The slot adds a display:contents wrapper: wrap its flex parent, not the wrapper.
   Match the native settings/account launcher spacing, typography and hover tokens. */
div:has(> div > .chatgpt-plan-sidebar) { flex-wrap: wrap; }
.chatgpt-plan-sidebar { position: relative; display: flex; align-items: center; gap: 8px; flex: 1 0 100%; min-width: 0; box-sizing: border-box; height: 44px; min-height: 44px; padding: 6px; border: 0; border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px; }
.chatgpt-plan-sidebar p { margin: 0; }
.chatgpt-plan-sidebar-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 24px; height: 24px; }
.chatgpt-plan-sidebar-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chatgpt-plan-sidebar[data-reconnect="true"] .chatgpt-plan-sidebar-icon, .chatgpt-plan-sidebar[data-reconnect="true"] .chatgpt-plan-sidebar-label { color: var(--dsw-alias-state-warn-primary); }
.chatgpt-plan-sidebar a { color: inherit; text-decoration: none; }
/* The usage link covers the whole notice: one pointer target for the footer row,
   matching the model-usage sidebar button. */
.chatgpt-plan-sidebar:has(a) { cursor: pointer; }
.chatgpt-plan-sidebar a::after { content: ''; position: absolute; inset: 0; }
.chatgpt-plan-sidebar:has(a:hover) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.chatgpt-plan-sidebar:has(a:focus-visible) { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.chatgpt-plan-sidebar a:focus-visible { outline: none; }
.chatgpt-plan-sidebar[data-wide="false"] { justify-content: center; gap: 0; height: 36px; min-height: 36px; padding: 0; }
.chatgpt-plan-sidebar-compact { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 0; border-radius: var(--dsw-radius-md); }

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

/* First-sign-in confirmation. It lives in the frame-wide overlay layer, so it needs no
   portal; the surface, elevation and focus ring reuse the shell's own tokens. */
.chatgpt-plan-overlay { position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--dsw-alias-bg-mask-1, #00000080); }
.chatgpt-plan-dialog { box-sizing: border-box; width: min(440px, 100%); padding: 20px; border: .5px solid var(--dsw-alias-border-l4, #7775); border-radius: var(--dsw-radius-lg, 16px); background: var(--dsw-alias-bg-layer-1, Canvas); box-shadow: var(--dsw-elevation-prominent, 0 16px 48px #0006); color: var(--dsw-alias-label-primary, CanvasText); }
.chatgpt-plan-dialog h2 { margin: 0 0 8px; font-size: 15px; font-weight: 500; line-height: 22px; }
.chatgpt-plan-dialog p { margin: 0 0 16px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.chatgpt-plan-dialog-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px; }
.chatgpt-plan-dialog button { border: 1px solid transparent; border-radius: 8px; padding: 8px 16px; font: inherit; cursor: pointer; }
.chatgpt-plan-dialog-primary { background: var(--dsw-alias-button-primary-fill, #101010); color: var(--dsw-alias-label-primary-foreground, #fff); }
.chatgpt-plan-dialog a { color: var(--dsw-alias-label-secondary); text-decoration: underline; text-underline-offset: 3px; }
.chatgpt-plan-dialog a:hover { color: var(--dsw-alias-label-primary); }
.chatgpt-plan-dialog button:focus-visible, .chatgpt-plan-dialog a:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, currentColor)); outline-offset: 2px; }
`;
