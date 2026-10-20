import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { ContentApi, UserDataApi } from '../../core/contracts';
import { BOOKMARK_NOTE_MAX, Bookmark, BookmarkFolder, FOLDER_NAME_MAX } from '../../core/models';
import { ReaderUiService } from '../../core/reader-ui.service';
import { formatDate } from '../sheets/nav-helpers';
import {
  FilterContext,
  FolderFilter,
  KindFilter,
  SortMode,
  effectiveFolderId,
  filterBookmarks,
  folderCounts,
  folderNameSuggestions,
  isPageEndVerse,
} from './bookmark-filters';

type NewFolderTarget = 'filter' | 'move';

@Component({
  selector: 'app-bookmarks-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <button type="button" class="mf-icon-btn" aria-label="Kembali ke mushaf" (click)="back()">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <h1 class="mf-display">Kelola penanda</h1>
      <button
        type="button"
        class="mf-btn mf-btn--ghost selbtn"
        [attr.aria-pressed]="selectMode()"
        (click)="toggleSelectMode()"
      >
        {{ selectMode() ? 'Selesai' : 'Pilih' }}
      </button>
    </header>

    <main class="wrap" [class.padbar]="selectMode()">
      <input
        class="mf-input"
        type="search"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
        placeholder="Cari surah, 2:255, atau catatan"
        aria-label="Cari penanda"
        autocomplete="off"
      />

      <div class="opts">
        <div class="mf-segmented" role="group" aria-label="Urutan">
          <button
            type="button"
            [attr.aria-pressed]="sort() === 'mushaf'"
            (click)="sort.set('mushaf')"
          >
            Urutan mushaf
          </button>
          <button
            type="button"
            [attr.aria-pressed]="sort() === 'recent'"
            (click)="sort.set('recent')"
          >
            Terbaru
          </button>
        </div>
        <div class="mf-segmented" role="group" aria-label="Jenis penanda">
          <button type="button" [attr.aria-pressed]="kind() === 'all'" (click)="kind.set('all')">
            Semua
          </button>
          <button
            type="button"
            [attr.aria-pressed]="kind() === 'verse'"
            (click)="kind.set('verse')"
          >
            Ayat
          </button>
          <button type="button" [attr.aria-pressed]="kind() === 'page'" (click)="kind.set('page')">
            Halaman
          </button>
        </div>
      </div>

      <div class="chips" role="group" aria-label="Folder">
        <button
          type="button"
          class="chip"
          [class.on]="folder() === 'all'"
          [attr.aria-pressed]="folder() === 'all'"
          (click)="pickFolder('all')"
        >
          Semua <span class="cnt">{{ counts().all }}</span>
        </button>
        <button
          type="button"
          class="chip"
          [class.on]="folder() === 'none'"
          [attr.aria-pressed]="folder() === 'none'"
          (click)="pickFolder('none')"
        >
          Tanpa folder <span class="cnt">{{ counts().none }}</span>
        </button>
        @for (f of folders(); track f.id) {
          <span class="chipgroup" [class.on]="folder() === f.id">
            <button
              type="button"
              class="chip inner"
              [class.on]="folder() === f.id"
              [attr.aria-pressed]="folder() === f.id"
              (click)="pickFolder(f.id)"
            >
              {{ f.name }} <span class="cnt">{{ counts().byFolder[f.id] }}</span>
            </button>
            <button
              type="button"
              class="menubtn"
              [attr.aria-label]="'Menu folder ' + f.name"
              [attr.aria-expanded]="menuFor() === f.id"
              (click)="toggleMenu(f.id)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
          </span>
        }
        <button
          type="button"
          class="chip dashed"
          [attr.aria-expanded]="creating() === 'filter'"
          (click)="startCreate('filter')"
        >
          + Folder baru
        </button>
      </div>

      @if (creating() === 'filter') {
        <ng-container *ngTemplateOutlet="newFolderForm" />
      }

      @if (menuFolder(); as mf) {
        <section class="panel" [attr.aria-label]="'Folder ' + mf.name">
          @if (renaming() === mf.id) {
            <label class="lbl" for="rename-input">Ganti nama folder</label>
            <input
              id="rename-input"
              class="mf-input"
              [value]="nameDraft()"
              (input)="nameDraft.set($any($event.target).value)"
              (keydown.enter)="saveRename(mf)"
              [attr.maxlength]="nameMax"
            />
            @if (formError()) {
              <div class="err" role="alert">{{ formError() }}</div>
            }
            <div class="row end">
              <button type="button" class="mf-btn mf-btn--ghost" (click)="renaming.set(null)">
                Batal
              </button>
              <button type="button" class="mf-btn mf-btn--primary" (click)="saveRename(mf)">
                Simpan
              </button>
            </div>
          } @else if (confirmFolderDelete() === mf.id) {
            <div class="strong">Hapus folder "{{ mf.name }}"?</div>
            <label class="check">
              <input
                type="checkbox"
                [checked]="alsoDelete()"
                (change)="alsoDelete.set($any($event.target).checked)"
              />
              <span>Hapus juga {{ counts().byFolder[mf.id] }} penandanya</span>
            </label>
            <div class="hint">Jika tidak dicentang, penanda dipindah ke "Tanpa folder".</div>
            <div class="row end">
              <button
                type="button"
                class="mf-btn mf-btn--ghost"
                (click)="confirmFolderDelete.set(null)"
              >
                Batal
              </button>
              <button type="button" class="mf-btn mf-btn--danger" (click)="deleteFolder(mf)">
                Hapus folder
              </button>
            </div>
          } @else {
            <div class="row">
              <button type="button" class="mf-btn mf-btn--outline" (click)="startRename(mf)">
                Ganti nama
              </button>
              <button
                type="button"
                class="mf-btn mf-btn--outline danger"
                (click)="startFolderDelete(mf)"
              >
                Hapus folder
              </button>
            </div>
          }
        </section>
      }

      <div class="meta" aria-live="polite">
        @if (selectMode()) {
          <span>{{ selectedIds().length }} dipilih dari {{ rows().length }}</span>
          <button type="button" class="mf-btn mf-btn--ghost small" (click)="toggleAll()">
            {{ allSelected() ? 'Batal pilih' : 'Pilih semua' }}
          </button>
        } @else {
          <span>{{ rows().length }} penanda</span>
        }
      </div>

      <ul class="list">
        @for (r of rows(); track r.b.id) {
          <li class="item" [class.sel]="isSelected(r.b.id)">
            @if (selectMode()) {
              <label class="cb">
                <input
                  type="checkbox"
                  [checked]="isSelected(r.b.id)"
                  (change)="toggleSelected(r.b.id)"
                  [attr.aria-label]="'Pilih ' + r.title"
                />
              </label>
            }
            <button type="button" class="go" (click)="rowTap(r.b)">
              <span class="title"
                >{{ r.title }}
                @if (r.pageEnd) {
                  <span class="end-badge" title="Ayat terakhir di halaman ini">✓ Akhir hal.</span>
                }
              </span>
              <span class="sub">{{ r.sub }}</span>
              @if (r.folderName) {
                <span class="tag">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path
                      d="M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"
                    />
                  </svg>
                  {{ r.folderName }}
                </span>
              }
              @if (r.b.note && editingNote() !== r.b.id) {
                <span class="note">{{ r.b.note }}</span>
              }
            </button>
            <button
              type="button"
              class="mf-icon-btn notebtn"
              [class.has]="!!r.b.note"
              [attr.aria-expanded]="editingNote() === r.b.id"
              [attr.aria-label]="(r.b.note ? 'Ubah catatan ' : 'Tambah catatan ') + r.title"
              (click)="toggleNote(r.b)"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M5 5h14v10l-5 5H5zM14 20v-5h5M8.5 9.5h7M8.5 13h4" />
              </svg>
            </button>
            @if (editingNote() === r.b.id) {
              <div class="noteedit">
                <label class="lbl" [attr.for]="'note-' + r.b.id">Catatan</label>
                <textarea
                  [id]="'note-' + r.b.id"
                  class="mf-input ta"
                  rows="3"
                  [attr.maxlength]="noteMax"
                  [value]="noteDraft()"
                  (input)="noteDraft.set($any($event.target).value)"
                ></textarea>
                <div class="counter" [class.warn]="noteDraft().length >= noteMax">
                  {{ noteDraft().length }}/{{ noteMax }}
                </div>
                @if (formError()) {
                  <div class="err" role="alert">{{ formError() }}</div>
                }
                <div class="row end">
                  @if (r.b.note) {
                    <button
                      type="button"
                      class="mf-btn mf-btn--ghost danger"
                      (click)="clearNote(r.b)"
                    >
                      Hapus catatan
                    </button>
                  }
                  <button
                    type="button"
                    class="mf-btn mf-btn--ghost"
                    (click)="editingNote.set(null)"
                  >
                    Batal
                  </button>
                  <button type="button" class="mf-btn mf-btn--primary" (click)="saveNote(r.b)">
                    Simpan
                  </button>
                </div>
              </div>
            }
          </li>
        } @empty {
          <li class="empty">
            <div class="etitle">{{ emptyTitle() }}</div>
            <div class="ehint">{{ emptyHint() }}</div>
          </li>
        }
      </ul>
    </main>

    @if (selectMode()) {
      <div class="bar" role="region" aria-label="Aksi penanda terpilih">
        @if (confirmDelete()) {
          <span class="bartxt" role="alert">Hapus {{ selectedIds().length }} penanda?</span>
          <button type="button" class="mf-btn mf-btn--ghost" (click)="confirmDelete.set(false)">
            Batal
          </button>
          <button type="button" class="mf-btn mf-btn--danger" (click)="deleteSelected()">
            Hapus
          </button>
        } @else {
          <span class="bartxt" aria-live="polite">{{ selectedIds().length }} dipilih</span>
          <button
            type="button"
            class="mf-btn mf-btn--outline"
            [disabled]="selectedIds().length === 0"
            [attr.aria-expanded]="moveOpen()"
            (click)="toggleMove()"
          >
            Pindahkan ke…
          </button>
          <button
            type="button"
            class="mf-btn mf-btn--danger"
            [disabled]="selectedIds().length === 0"
            (click)="confirmDelete.set(true)"
          >
            Hapus
          </button>
        }
        @if (moveOpen() && !confirmDelete()) {
          <div class="movepanel">
            <div class="mf-eyebrow">Pindahkan ke</div>
            <div class="chips wrap2">
              <button type="button" class="chip" (click)="moveTo(null)">Tanpa folder</button>
              @for (f of folders(); track f.id) {
                <button type="button" class="chip" (click)="moveTo(f.id)">{{ f.name }}</button>
              }
              <button type="button" class="chip dashed" (click)="startCreate('move')">
                + Folder baru
              </button>
            </div>
            @if (creating() === 'move') {
              <ng-container *ngTemplateOutlet="newFolderForm" />
            }
          </div>
        }
      </div>
    }

    <ng-template #newFolderForm>
      <section class="panel" aria-label="Folder baru">
        <label class="lbl" for="new-folder-input">Nama folder baru</label>
        <input
          id="new-folder-input"
          class="mf-input"
          [value]="nameDraft()"
          (input)="nameDraft.set($any($event.target).value)"
          (keydown.enter)="saveCreate()"
          [attr.maxlength]="nameMax"
          placeholder="mis. Murajaah pekan ini"
        />
        @if (suggestions().length) {
          <div class="chips wrap2" aria-label="Saran nama">
            @for (s of suggestions(); track s) {
              <button type="button" class="chip" (click)="nameDraft.set(s)">{{ s }}</button>
            }
          </div>
        }
        @if (formError()) {
          <div class="err" role="alert">{{ formError() }}</div>
        }
        <div class="row end">
          <button type="button" class="mf-btn mf-btn--ghost" (click)="cancelCreate()">Batal</button>
          <button type="button" class="mf-btn mf-btn--primary" (click)="saveCreate()">
            Simpan
          </button>
        </div>
      </section>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      position: fixed;
      inset: 0;
      overflow-y: auto;
      background: var(--mf-surround);
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
    .top > * {
      max-width: 720px;
    }
    h1 {
      flex: 1;
      margin: 0;
      font-size: 20px;
      font-weight: 500;
    }
    .selbtn {
      padding: 0 var(--mf-space-3);
    }
    .wrap {
      max-width: 720px;
      margin: 0 auto;
      padding: var(--mf-space-4) var(--mf-space-4) var(--mf-space-8);
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .wrap.padbar {
      padding-bottom: 180px;
    }
    .opts {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    @media (min-width: 560px) {
      .opts {
        flex-direction: row;
      }
      .opts > * {
        flex: 1;
      }
    }
    .chips {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
      align-items: center;
    }
    .chips.wrap2 {
      flex-wrap: wrap;
      overflow: visible;
    }
    .chip {
      flex: none;
      min-height: var(--mf-tap);
      padding: 0 14px;
      border-radius: 22px;
      border: 1px solid var(--ui-line);
      background: var(--ui-surface);
      color: var(--ui-ink);
      font-size: 13.5px;
      font-weight: 500;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .chip.on {
      background: var(--ui-primary);
      color: var(--ui-on);
      border-color: var(--ui-primary);
    }
    .chip.dashed {
      border-style: dashed;
      border-color: var(--ui-accent);
      background: transparent;
      color: var(--ui-primary);
    }
    .chip .cnt {
      font-size: 12px;
      opacity: 0.75;
    }
    .chipgroup {
      flex: none;
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--ui-line);
      border-radius: 22px;
      background: var(--ui-surface);
    }
    .chipgroup.on {
      border-color: var(--ui-primary);
    }
    .chip.inner {
      border: none;
      background: transparent;
      padding-right: 6px;
    }
    .chip.inner.on {
      background: var(--ui-primary);
      color: var(--ui-on);
      border-radius: 22px 0 0 22px;
    }
    .menubtn {
      width: var(--mf-tap);
      min-height: var(--mf-tap);
      border: none;
      background: transparent;
      color: var(--ui-muted);
      border-radius: 0 22px 22px 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: var(--mf-space-3);
      border-radius: var(--mf-radius-lg);
      background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-surface));
      border: 1px solid var(--ui-hair);
    }
    .lbl {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--ui-muted);
    }
    .strong {
      font-weight: 600;
      font-size: 15px;
    }
    .hint {
      font-size: 13px;
      color: var(--ui-muted);
    }
    .check {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: var(--mf-tap);
      font-size: 14.5px;
    }
    .check input,
    .cb input {
      width: 22px;
      height: 22px;
      accent-color: var(--ui-primary);
    }
    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .row.end {
      justify-content: flex-end;
    }
    .danger {
      color: var(--mf-danger);
    }
    .mf-btn--outline.danger {
      border-color: var(--mf-danger);
    }
    .err {
      font-size: 13.5px;
      color: var(--mf-danger);
      font-weight: 500;
    }
    .meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 36px;
      font-size: 13.5px;
      color: var(--ui-muted);
    }
    .small {
      min-height: var(--mf-tap);
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      background: var(--ui-surface);
      border-radius: var(--mf-radius-lg);
      border: 1px solid var(--ui-hair);
      overflow: hidden;
    }
    .item {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      padding: 4px 4px 4px 8px;
      border-bottom: 1px solid var(--ui-hair);
    }
    .item:last-child {
      border-bottom: none;
    }
    .item.sel {
      background: color-mix(in srgb, var(--ui-primary) 8%, transparent);
    }
    .cb {
      width: var(--mf-tap);
      height: var(--mf-tap);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }
    .go {
      flex: 1;
      min-width: 0;
      min-height: var(--mf-tap);
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      padding: 8px 6px;
      border: none;
      background: transparent;
      text-align: left;
      color: var(--ui-ink);
    }
    .end-badge {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
      vertical-align: 1px;
      color: var(--ui-primary);
      background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
    }
    .title {
      font-size: 15px;
      font-weight: 500;
    }
    .sub {
      font-size: 12.5px;
      color: var(--ui-muted);
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--ui-accent-ink);
    }
    .note {
      font-size: 13px;
      color: var(--ui-ink2);
      font-style: italic;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .notebtn {
      flex: none;
      color: var(--ui-muted);
    }
    .notebtn.has {
      color: var(--ui-primary);
    }
    .noteedit {
      flex-basis: 100%;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 4px 8px 12px;
    }
    .ta {
      min-height: 80px;
      padding: 10px 12px;
      resize: vertical;
      font-family: inherit;
    }
    .counter {
      align-self: flex-end;
      font-size: 12px;
      color: var(--ui-muted);
    }
    .counter.warn {
      color: var(--mf-danger);
    }
    .empty {
      padding: 32px 16px;
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .etitle {
      font-family: var(--ui-display);
      font-size: 19px;
    }
    .ehint {
      font-size: 14px;
      color: var(--ui-ink2);
      line-height: 1.5;
    }
    .bar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 3;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px 16px calc(var(--mf-safe-bottom) + 10px);
      background: var(--ui-surface);
      border-top: 1px solid var(--ui-line);
      box-shadow: 0 -6px 20px color-mix(in srgb, var(--ui-ink) 10%, transparent);
    }
    .bartxt {
      flex: 1;
      font-size: 14.5px;
      font-weight: 500;
      min-width: 90px;
    }
    .movepanel {
      flex-basis: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 40vh;
      overflow-y: auto;
    }
  `,
  imports: [NgTemplateOutlet],
})
export class BookmarksManager {
  private readonly router = inject(Router);
  private readonly ui = inject(ReaderUiService);
  private readonly content = inject(ContentApi);
  private readonly userData = inject(UserDataApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly noteMax = BOOKMARK_NOTE_MAX;
  protected readonly nameMax = FOLDER_NAME_MAX;

  protected readonly query = signal('');
  protected readonly sort = signal<SortMode>('mushaf');
  protected readonly kind = signal<KindFilter>('all');
  protected readonly folder = signal<FolderFilter>('all');

  protected readonly selectMode = signal(false);
  private readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly confirmDelete = signal(false);
  protected readonly moveOpen = signal(false);

  protected readonly creating = signal<NewFolderTarget | null>(null);
  protected readonly nameDraft = signal('');
  protected readonly formError = signal<string | null>(null);
  protected readonly menuFor = signal<string | null>(null);
  protected readonly renaming = signal<string | null>(null);
  protected readonly confirmFolderDelete = signal<string | null>(null);
  protected readonly alsoDelete = signal(false);

  protected readonly editingNote = signal<string | null>(null);
  protected readonly noteDraft = signal('');

  protected readonly folders = this.userData.folders;

  constructor() {
    void this.content.load();
  }

  private readonly ctx = computed<FilterContext>(() => {
    const index = this.content.index();
    return {
      surahs: index?.surahs ?? [],
      surahOfPage: (p) => (index ? this.content.surahAt(p) : undefined),
    };
  });

  protected readonly counts = computed(() =>
    folderCounts(this.userData.bookmarks(), this.folders()),
  );

  protected readonly rows = computed(() => {
    const index = this.content.index();
    const folders = this.folders();
    const list = filterBookmarks(
      this.userData.bookmarks(),
      folders,
      { query: this.query(), kind: this.kind(), folder: this.folder(), sort: this.sort() },
      this.ctx(),
    );
    return list.map((b) => {
      const date = formatDate(b.createdAt);
      const fid = effectiveFolderId(b, folders);
      const folderName = fid ? (folders.find((f) => f.id === fid)?.name ?? null) : null;
      if (b.kind === 'verse' && b.surah && b.ayah) {
        const name = index?.surahs[b.surah - 1]?.nameLatin ?? `Surah ${b.surah}`;
        const juz = index ? this.content.juzAt(b.page).number : '';
        const pageEnd = !!index && isPageEndVerse(b, (p) => this.content.pageMeta(p).last);
        return {
          b,
          pageEnd,
          title: `${name} · Ayat ${b.ayah}`,
          sub: pageEnd
            ? `Hal. ${b.page} selesai dibaca · Juz ${juz} · ${date}`
            : `Hal. ${b.page} · Juz ${juz} · ${date}`,
          folderName,
        };
      }
      const name = index ? this.content.surahAt(b.page).nameLatin : '';
      const juz = index ? this.content.juzAt(b.page).number : '';
      return {
        b,
        pageEnd: false,
        title: `Halaman ${b.page} · ${name}`,
        sub: `Hal. ${b.page} · Juz ${juz} · ${date}`,
        folderName,
      };
    });
  });

  protected readonly selectedIds = computed(() => {
    const sel = this.selected();
    return this.rows()
      .map((r) => r.b.id)
      .filter((id) => sel.has(id));
  });
  protected readonly allSelected = computed(
    () => this.rows().length > 0 && this.selectedIds().length === this.rows().length,
  );

  protected readonly menuFolder = computed<BookmarkFolder | null>(
    () => this.folders().find((f) => f.id === this.menuFor()) ?? null,
  );

  protected readonly suggestions = computed(() =>
    folderNameSuggestions(this.folders().map((f) => f.name)),
  );

  protected readonly emptyTitle = computed(() => {
    if (this.userData.bookmarks().length === 0) return 'Belum ada penanda';
    if (this.query().trim()) return 'Tidak ada penanda yang cocok';
    return this.folder() === 'all' ? 'Tidak ada penanda di sini' : 'Folder ini masih kosong';
  });
  protected readonly emptyHint = computed(() => {
    if (this.userData.bookmarks().length === 0)
      return 'Ketuk sebuah ayat lalu pilih Tandai, atau tandai halaman dari bilah bawah.';
    if (this.query().trim()) return 'Coba nama surah, format 2:255, atau kata dari catatan.';
    return 'Pilih "Pilih", centang penanda, lalu "Pindahkan ke…" untuk mengisi folder ini.';
  });

  // ---- navigation ----
  protected back(): void {
    const page = this.userData.position()?.page ?? this.ui.currentPage();
    void this.router.navigate(['/hal', page]);
  }

  protected rowTap(b: Bookmark): void {
    if (this.selectMode()) {
      this.toggleSelected(b.id);
      return;
    }
    const highlight =
      b.kind === 'verse' && b.surah && b.ayah ? { surah: b.surah, ayah: b.ayah } : null;
    this.ui.goToPage(b.page, { highlight });
  }

  // ---- filters ----
  protected pickFolder(f: FolderFilter): void {
    this.folder.set(f);
  }

  // ---- selection ----
  protected toggleSelectMode(): void {
    const on = !this.selectMode();
    this.selectMode.set(on);
    this.selected.set(new Set());
    this.confirmDelete.set(false);
    this.moveOpen.set(false);
    if (!on && this.creating() === 'move') this.cancelCreate();
  }

  protected isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  protected toggleSelected(id: string): void {
    const next = new Set(this.selected());
    if (!next.delete(id)) next.add(id);
    this.selected.set(next);
    this.confirmDelete.set(false);
  }

  protected toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.rows().map((r) => r.b.id)));
    this.confirmDelete.set(false);
  }

  protected toggleMove(): void {
    this.moveOpen.update((v) => !v);
    if (this.creating() === 'move') this.cancelCreate();
  }

  protected async moveTo(folderId: string | null): Promise<void> {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    try {
      await this.userData.moveBookmarks(ids, folderId);
      const name = folderId
        ? (this.folders().find((f) => f.id === folderId)?.name ?? 'folder')
        : null;
      this.ui.showToast({
        message: name
          ? `${ids.length} penanda dipindahkan ke ${name}`
          : `${ids.length} penanda dikeluarkan dari folder`,
      });
      this.selected.set(new Set());
      this.moveOpen.set(false);
    } catch (e) {
      this.ui.showToast({ message: errMsg(e, 'Gagal memindahkan penanda') });
    }
  }

  protected async deleteSelected(): Promise<void> {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    try {
      const undo = await this.userData.removeBookmarks(ids);
      this.ui.showToast({
        message: ids.length === 1 ? 'Penanda dihapus' : `${ids.length} penanda dihapus`,
        actionLabel: 'Urungkan',
        action: () => void undo(),
        duration: 6000,
      });
      this.selected.set(new Set());
      this.confirmDelete.set(false);
    } catch (e) {
      this.ui.showToast({ message: errMsg(e, 'Gagal menghapus penanda') });
    }
  }

  // ---- folders ----
  protected startCreate(target: NewFolderTarget): void {
    if (this.creating() === target) {
      this.cancelCreate();
      return;
    }
    this.menuFor.set(null);
    this.creating.set(target);
    this.formError.set(null);
    this.nameDraft.set(this.suggestions()[0] ?? '');
    this.focusSoon('#new-folder-input');
  }

  protected cancelCreate(): void {
    this.creating.set(null);
    this.formError.set(null);
    this.nameDraft.set('');
  }

  protected async saveCreate(): Promise<void> {
    const target = this.creating();
    if (!target) return;
    try {
      const f = await this.userData.createFolder(this.nameDraft());
      this.cancelCreate();
      if (target === 'move') {
        const ids = this.selectedIds();
        if (ids.length) await this.userData.moveBookmarks(ids, f.id);
        this.selected.set(new Set());
        this.moveOpen.set(false);
        this.ui.showToast({ message: `Folder "${f.name}" dibuat` });
      } else {
        this.folder.set(f.id);
      }
    } catch (e) {
      this.formError.set(errMsg(e, 'Folder gagal dibuat'));
    }
  }

  protected toggleMenu(id: string): void {
    this.menuFor.update((cur) => (cur === id ? null : id));
    this.renaming.set(null);
    this.confirmFolderDelete.set(null);
    this.formError.set(null);
    if (this.creating() === 'filter') this.cancelCreate();
  }

  protected startRename(f: BookmarkFolder): void {
    this.renaming.set(f.id);
    this.nameDraft.set(f.name);
    this.formError.set(null);
    this.focusSoon('#rename-input');
  }

  protected async saveRename(f: BookmarkFolder): Promise<void> {
    try {
      await this.userData.renameFolder(f.id, this.nameDraft());
      this.renaming.set(null);
      this.formError.set(null);
    } catch (e) {
      this.formError.set(errMsg(e, 'Nama folder gagal diubah'));
    }
  }

  protected startFolderDelete(f: BookmarkFolder): void {
    this.alsoDelete.set(false);
    this.confirmFolderDelete.set(f.id);
  }

  protected async deleteFolder(f: BookmarkFolder): Promise<void> {
    const withBookmarks = this.alsoDelete();
    try {
      const undo = await this.userData.deleteFolder(f.id, { deleteBookmarks: withBookmarks });
      if (this.folder() === f.id) this.folder.set('all');
      this.menuFor.set(null);
      this.confirmFolderDelete.set(null);
      this.ui.showToast({
        message: withBookmarks
          ? `Folder "${f.name}" dan penandanya dihapus`
          : `Folder "${f.name}" dihapus`,
        actionLabel: 'Urungkan',
        action: () => void undo(),
        duration: 6000,
      });
    } catch (e) {
      this.ui.showToast({ message: errMsg(e, 'Folder gagal dihapus') });
    }
  }

  // ---- notes ----
  protected toggleNote(b: Bookmark): void {
    if (this.editingNote() === b.id) {
      this.editingNote.set(null);
      return;
    }
    this.editingNote.set(b.id);
    this.noteDraft.set(b.note ?? '');
    this.formError.set(null);
    this.focusSoon(`#note-${CSS.escape(b.id)}`);
  }

  protected async saveNote(b: Bookmark): Promise<void> {
    try {
      await this.userData.setBookmarkNote(b.id, this.noteDraft());
      this.editingNote.set(null);
      this.formError.set(null);
    } catch (e) {
      this.formError.set(errMsg(e, 'Catatan gagal disimpan'));
    }
  }

  protected async clearNote(b: Bookmark): Promise<void> {
    try {
      await this.userData.setBookmarkNote(b.id, null);
      this.editingNote.set(null);
    } catch (e) {
      this.formError.set(errMsg(e, 'Catatan gagal dihapus'));
    }
  }

  private focusSoon(selector: string): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), 30);
  }
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
