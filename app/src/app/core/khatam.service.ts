import { Injectable, inject, signal } from '@angular/core';
import { UserDataApi } from './contracts';
import { ProgressService } from './progress/progress.service';
import { ReaderUiService } from './reader-ui.service';

export interface KhatamDialogState {
  /** The khatam being completed ("khatam ke-N"). */
  n: number;
  /** Current verse/page bookmarks that would be archived. */
  count: number;
  /** Name of the archived folder: "Khatam ke-N · Okt 2026". */
  folderName: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "Khatam ke-3 · Okt 2026" */
export function khatamFolderName(n: number, date: Date = new Date()): string {
  return `Khatam ke-${n} · ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * One place for "I finished the Qur'an": the dialog opened from page 604 and from the progress
 * sheet both end here, so they archive the round's bookmarks and start the next round alike.
 */
@Injectable({ providedIn: 'root' })
export class KhatamService {
  private readonly userData = inject(UserDataApi);
  private readonly progress = inject(ProgressService);
  private readonly ui = inject(ReaderUiService);

  /** Dialog content while it is open, else null (rendered by KhatamDialog). */
  readonly dialog = signal<KhatamDialogState | null>(null);
  readonly busy = signal(false);

  /**
   * Number of the khatam being completed: the open progress round when tracking is on,
   * otherwise (archived khatam folders) + 1.
   */
  nextNumber(): number {
    const round = this.progress.enabled() ? this.progress.currentRound() : null;
    if (round) return round.n;
    const archived = this.userData.archivedFolders().filter((f) => /^khatam ke-\d+/i.test(f.name));
    return archived.length + 1;
  }

  open(): void {
    const n = this.nextNumber();
    this.dialog.set({
      n,
      count: this.userData.bookmarks().length,
      folderName: khatamFolderName(n),
    });
  }

  close(): void {
    if (!this.busy()) this.dialog.set(null);
  }

  /** "Arsipkan & mulai baru": archives the current bookmarks, finishes the round when tracking. */
  async confirm(): Promise<void> {
    const st = this.dialog();
    if (!st || this.busy()) return;
    this.busy.set(true);
    try {
      const res = await this.userData.archiveCurrentBookmarks(st.folderName);
      let roundFailed = false;
      if (this.progress.enabled() && this.progress.currentRound()) {
        try {
          await this.progress.startNextRound();
        } catch {
          roundFailed = true;
        }
      }
      this.dialog.set(null);
      if (roundFailed) {
        this.ui.showToast({
          message: 'Penanda diarsipkan, tetapi putaran baru gagal dimulai.',
          duration: 8000,
        });
      } else if (res.count > 0) {
        this.ui.showToast({
          message: `${res.count} penanda diarsipkan`,
          actionLabel: 'Urungkan',
          action: () => void res.undo(),
          duration: 6000,
        });
      } else {
        this.ui.showToast({ message: `Alhamdulillah, khatam ke-${st.n}`, duration: 6000 });
      }
    } catch (e) {
      this.ui.showToast({
        message:
          e instanceof Error && e.message ? e.message : 'Penanda gagal diarsipkan. Coba lagi.',
        duration: 8000,
      });
    } finally {
      this.busy.set(false);
    }
  }
}
