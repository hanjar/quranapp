import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-floating-menu',
  template: `
    <div
      class="floating-menu"
      [style.top.px]="top()"
      [style.left.px]="left()"
    >
      <button class="menu-btn" title="Bookmark" (click)="bookmark.emit()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
      <button class="menu-btn" title="Terjemahan" (click)="translate.emit()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      </button>
      <button class="menu-btn" title="Play Audio" (click)="play.emit()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21"/>
        </svg>
      </button>
      <button class="menu-btn" title="Catatan" (click)="note.emit()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
    </div>
  `,
  styles: `
    .floating-menu {
      position: absolute;
      z-index: 100;
      display: flex;
      gap: 4px;
      background: var(--bg-secondary);
      border-radius: 9999px;
      padding: 6px 8px;
      box-shadow: var(--shadow-medium);
      transform: translateX(-50%);
    }
    .menu-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border: none;
      background: transparent;
      color: var(--cyan-dark);
      border-radius: 50%;
      cursor: pointer;
      transition: background 0.15s, transform 0.15s;
      &:hover, &:active {
        background: rgba(0, 229, 255, 0.1);
        transform: scale(1.05);
      }
    }
  `,
})
export class FloatingMenuComponent {
  top = input.required<number>();
  left = input.required<number>();

  bookmark = output<void>();
  translate = output<void>();
  play = output<void>();
  note = output<void>();
}
