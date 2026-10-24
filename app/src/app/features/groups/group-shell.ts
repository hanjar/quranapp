/** Shared page chrome for the khatam bersama pages (full page, like the doa / tafsir pages). */
export const GROUP_PAGE_STYLES = `
  :host {
    display: block;
    position: fixed;
    inset: 0;
    overflow-y: auto;
    background: var(--ui-surface);
    color: var(--ui-ink);
    font-family: var(--ui-font);
  }
  .top {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: calc(var(--mf-safe-top) + 6px) 8px 6px;
    background: var(--ui-surface);
    border-bottom: 1px solid var(--ui-hair);
  }
  .top h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 20px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .wrap {
    max-width: 640px;
    margin: 0 auto;
    padding: 16px 16px calc(var(--mf-safe-bottom) + 40px);
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .card {
    padding: 14px;
    border: 1px solid var(--ui-hair);
    border-radius: var(--mf-radius-md);
    background: var(--ui-surface);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  p {
    margin: 0;
  }
  .muted {
    color: var(--ui-muted);
    font-size: 13.5px;
    line-height: 1.5;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .row .mf-input {
    flex: 1;
    min-width: 0;
  }
  .err {
    color: var(--mf-danger);
    font-size: 13.5px;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--ui-ink) 10%, transparent);
    overflow: hidden;
  }
  .bar > span {
    display: block;
    height: 100%;
    background: var(--ui-primary);
    border-radius: 4px;
    transition: width var(--mf-dur-base) var(--mf-ease);
  }
`;
