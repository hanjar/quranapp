/** Shared styles for settings/offline/account/about sheet bodies (CSS variables only). */
export const SHEET_STYLES = `
  :host { display: flex; flex-direction: column; gap: var(--mf-space-5); padding: 0 var(--mf-space-5) var(--mf-space-6); color: var(--ui-ink); }
  section { display: flex; flex-direction: column; gap: var(--mf-space-3); }
  h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--ui-ink2); }
  p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--ui-ink2); }
  .muted { color: var(--ui-muted); font-size: 13px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .card { display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: var(--mf-radius-lg); background: transparent; text-align: left; border: 1px solid var(--ui-line); }
  .card[aria-pressed='true'] { border: 2px solid var(--ui-primary); padding: 7px; }
  .swatch { display: block; height: 52px; border-radius: var(--mf-radius-sm); border: 1px solid var(--ui-line); }
  .card .name { font-size: 13px; line-height: 1.25; }
  .card .sub { font-size: 11.5px; color: var(--ui-muted); }
  .dots { display: flex; gap: 6px; }
  .dot { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--ui-line); }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 52px; width: 100%; border: none; border-bottom: 1px solid var(--ui-hair); background: transparent; padding: 0; font-size: 15px; text-align: left; color: var(--ui-ink); }
  .row .end { color: var(--ui-muted); font-size: 13px; text-align: right; display: flex; align-items: center; gap: 6px; }
  .row.danger { color: var(--mf-danger); }
  .chev { font-size: 18px; }
  .switch { position: relative; flex: none; width: 48px; height: 28px; border-radius: 14px; border: none; background: var(--ui-line); padding: 0; transition: background var(--mf-dur-fast); }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform var(--mf-dur-fast) var(--mf-ease); }
  .switch[aria-checked='true'] { background: var(--ui-primary); }
  .switch[aria-checked='true']::after { transform: translateX(20px); }
  .switch-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 52px; border-bottom: 1px solid var(--ui-hair); font-size: 15px; }
  .switch-row .hit { min-height: var(--mf-tap); display: flex; align-items: center; }
  .stack { display: flex; flex-direction: column; gap: 10px; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; }
  .actions .mf-btn { flex: 1 1 auto; }
  .panel { display: flex; flex-direction: column; gap: 10px; padding: var(--mf-space-4); border-radius: var(--mf-radius-lg); border: 1px solid var(--ui-line); background: var(--ui-surface); }
  .panel.warn { border-color: var(--ui-accent); background: color-mix(in srgb, var(--ui-accent) 8%, var(--ui-surface)); }
  .panel strong { font-size: 15px; }
  .bar { height: 8px; border-radius: 4px; background: var(--ui-hair); overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--ui-primary); transition: width var(--mf-dur-base); }
  .status-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--ui-primary); flex: none; }
  .status-dot.off { background: var(--ui-muted); }
  .link { color: var(--ui-primary); text-underline-offset: 3px; }
  ul { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; line-height: 1.45; color: var(--ui-ink2); }
  dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; font-size: 14px; }
  dt { color: var(--ui-muted); }
  dd { margin: 0; word-break: break-word; }
  .avatar { width: 44px; height: 44px; border-radius: 50%; background: var(--ui-primary); color: var(--ui-on); display: grid; place-items: center; font-size: 18px; font-weight: 600; flex: none; }
  .who { display: flex; align-items: center; gap: 12px; }
`;
