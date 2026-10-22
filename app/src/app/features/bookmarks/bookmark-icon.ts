import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type BookmarkIconKind = 'verse' | 'end' | 'page' | 'favorite';

export const BOOKMARK_ICON_LABEL: Record<BookmarkIconKind, string> = {
  verse: 'Penanda ayat',
  end: 'Penanda akhir halaman',
  page: 'Penanda halaman',
  favorite: 'Ayat favorit',
};

/** Which icon a bookmark gets: page bookmark, verse at the end of its page, or plain verse. */
export function bookmarkIconKind(
  kind: 'verse' | 'page' | 'favorite',
  pageEnd: boolean,
): BookmarkIconKind {
  if (kind === 'favorite') return 'favorite';
  return kind === 'page' ? 'page' : pageEnd ? 'end' : 'verse';
}

const TAB_KEY = 'mf.bookmarkTab';
export type BookmarkTab = 'all' | 'verse' | 'page' | 'favorite';

export function loadBookmarkTab(storage: Pick<Storage, 'getItem'> | null = safeStorage()): BookmarkTab {
  try {
    const v = storage?.getItem(TAB_KEY);
    return v === 'verse' || v === 'page' || v === 'favorite' || v === 'all' ? v : 'all';
  } catch {
    return 'all';
  }
}

export function saveBookmarkTab(
  tab: BookmarkTab,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  try {
    storage?.setItem(TAB_KEY, tab);
  } catch {
    /* storage blocked: fine */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Three bookmark glyphs: red ribbon (verse), ribbon with check (verse at page end),
 * and a sheet with folded corner + small ribbon (page).
 */
@Component({
  selector: 'app-bookmark-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      stroke-width="1.4"
      stroke-linejoin="round"
      role="img"
      [attr.aria-label]="label()"
      [class]="'ic ic--' + kind()"
    >
      @switch (kind()) {
        @case ('page') {
          <path class="sheet" d="M5.5 3h9l4 4v14h-13z" />
          <path class="fold" d="M14.5 3v4h4" fill="none" />
          <path class="rib" d="M8.5 21v-7h4v7l-2-1.6z" />
        }
        @case ('favorite') {
          <path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" />
        }
        @case ('end') {
          <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />
          <path
            class="tick"
            d="M9.2 9.6l2 2 3.6-3.8"
            fill="none"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        }
        @default {
          <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    .ic--verse {
      fill: var(--ui-accent-icon);
      stroke: var(--ui-accent-icon);
    }
    .ic--favorite {
      fill: var(--ui-accent-icon);
      stroke: var(--ui-accent-icon);
    }
    .ic--end {
      fill: var(--ui-primary);
      stroke: var(--ui-primary);
    }
    .ic--end .tick {
      stroke: var(--ui-on);
    }
    .ic--page {
      stroke: var(--ui-primary);
    }
    .ic--page .sheet {
      fill: color-mix(in srgb, var(--ui-primary) 14%, transparent);
    }
    .ic--page .rib {
      fill: var(--ui-accent-icon);
      stroke: var(--ui-accent-icon);
    }
  `,
})
export class BookmarkIcon {
  readonly kind = input<BookmarkIconKind>('verse');
  readonly size = input(18);
  protected label(): string {
    return BOOKMARK_ICON_LABEL[this.kind()];
  }
}
