import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Bookmark, Folder } from '../models/bookmark.model';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { tap, catchError, of } from 'rxjs';

const STORAGE_KEY = 'quran_bookmarks';

@Injectable({ providedIn: 'root' })
export class BookmarkService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private apiUrl = `${environment.apiUrl}/bookmarks`;

  // Main state
  readonly folders = signal<Folder[]>([]);
  readonly looseBookmarks = signal<Bookmark[]>([]); // Bookmarks without folder (or root)
  // Derived flat list for legacy components or easy search/check
  readonly bookmarks = computed(() => {
    const flat: Bookmark[] = [...this.looseBookmarks()];
    this.folders().forEach(f => {
      flat.push(...f.bookmarks.map(b => ({ ...b, folderId: f.id, folder: f.name })));
    });
    return flat;
  });

  readonly bookmarkKeys = computed(() =>
    new Set(this.bookmarks().map(b => b.key)) // Key is still surah:ayah
  );

  constructor() {
    // Load local initially
    this.loadLocal();

    // Effect: sync when user logs in
    effect(() => {
      if (this.auth.currentUser()) {
        this.fetchCloud();
      } else {
        this.loadLocal(); // Revert to local if logged out
      }
    });
  }

  isBookmarked(surah: number, ayah: number): boolean {
    return this.bookmarkKeys().has(`${surah}:${ayah}`);
  }

  // --- CRUD Operations ---

  add(
    surah: number,
    ayah: number,
    surahNameAr: string,
    surahNameEn: string,
    folderIdOrName = 'Harian',
    label = ''
  ): void {
    const key = `${surah}:${ayah}`;
    if (this.isBookmarked(surah, ayah)) return;

    if (this.auth.currentUser()) {
      // Cloud add — folderIdOrName is always a real UUID from the modal (or 'Harian' string fallback for local)
      // If it's still the string 'Harian' (e.g. from direct calls), send null so backend assigns no folder_id
      const folder_id = (folderIdOrName && folderIdOrName !== 'Harian') ? folderIdOrName : null;
      this.http.post<Bookmark>(this.apiUrl, { surah, ayah, folder_id, label })
        .subscribe(() => this.fetchCloud());
    } else {
      // Local add
      const bookmark: Bookmark = {
        key, surah, ayah, surahNameAr, surahNameEn,
        folder: folderIdOrName, label, createdAt: new Date().toISOString()
      };

      // Since local structure relies on "folder" string property on bookmark,
      // we just push to a flat list in localStorage.
      // But for in-memory, we update signals.
      // Complex logic to mimic folders locally: Just flatten and re-parse.
      const current = this.bookmarks();
      this.saveLocal([...current, bookmark]);
    }
  }

  remove(key: string): void { // Start transition to ID
    const bookmark = this.bookmarks().find(b => b.key === key);
    if (!bookmark) return;

    if (this.auth.currentUser() && bookmark.id) {
      this.http.delete(`${this.apiUrl}/${bookmark.id}`).subscribe(() => this.fetchCloud());
    } else {
      const newBookmars = this.bookmarks().filter(b => b.key !== key);
      this.saveLocal(newBookmars);
    }
  }

  createFolder(name: string) {
    if (this.auth.currentUser()) {
      // Optimistic Update
      const tempId = `temp-${Date.now()}`;
      // Note: Folder interface matches backend schema?
      // Folder: { id, name, bookmarks: Bookmark[] }
      const tempFolder: Folder = { id: tempId, name, bookmarks: [], createdAt: new Date().toISOString() };

      // Add to beginning of list (assuming backend sorts DESC by created_at)
      this.folders.update(list => [tempFolder, ...list]);

      this.http.post<any>(`${this.apiUrl}/folders`, { name })
        .pipe(
          catchError(err => {
            console.error('Failed to create folder', err);
            // Revert optimistically updated state by re-fetching
            this.fetchCloud();
            return of(null);
          })
        )
        .subscribe(() => this.fetchCloud());
    } else {
      // Local/Offline mode
      // Create folder optimistically
      const tempId = name; // For local, name is the ID
      // Check if already exists
      if (this.folders().some(f => f.name === name)) {
        alert('Folder sudah ada');
        return;
      }

      const newFolder: Folder = { id: tempId, name, bookmarks: [], createdAt: new Date().toISOString() };
      this.folders.update(list => [newFolder, ...list]);

      // Note: We don't save to localStorage here because our schema is based on bookmarks.
      // The folder will disappear on refresh if empty.
      // But it allows the user to immediately add bookmarks to it, which WILL save it.
    }
  }

  renameFolder(id: string, name: string) {
    if (this.auth.currentUser()) {
      // Optimistic update
      this.folders.update(folders =>
        folders.map(f => f.id === id ? { ...f, name } : f)
      );

      // Cloud rename
      this.http.put(`${this.apiUrl}/folders/${id}`, { name })
        .pipe(
          tap(() => console.log('Folder renamed successfully', id)),
          catchError(err => {
            console.error('Failed to rename folder', err);
            this.fetchCloud(); // Revert/Sync on error
            return of(null);
          })
        )
        .subscribe(() => this.fetchCloud());
    } else {
      // Local rename
      // Local storage uses 'folder' string as ID/Name.
      // 'id' passed here is the folder name for local.
      const current = this.bookmarks();
      const updated = current.map(b => {
        if (b.folder === id) {
          return { ...b, folder: name };
        }
        return b;
      });
      this.saveLocal(updated);
    }
  }

  deleteFolder(id: string) {
    if (this.auth.currentUser()) {
      this.http.delete(`${this.apiUrl}/folders/${id}`).subscribe(() => this.fetchCloud());
    } else {
      // Local delete: remove all bookmarks in this folder
      const current = this.bookmarks();
      const updated = current.filter(b => b.folder !== id);
      this.saveLocal(updated);
    }
  }

  updateBookmark(idOrKey: string, updates: { label?: string, folderId?: string }) {
    if (this.auth.currentUser()) {
      // Optimistic update
      // Find and update bookmark in folders or looseBookmarks signals
      let updated = false;

      // Check folders
      const currentFolders = this.folders();
      const newFolders = currentFolders.map(f => {
        const idx = f.bookmarks.findIndex(b => b.id === idOrKey);
        if (idx !== -1) {
          const b = f.bookmarks[idx];
          const newB = { ...b, ...updates };
          // If folderId changed, effectively we should remove it here?
          // Since managing move optimistically is complex, we just update properties for now.
          // Ideally: if folderId differs, remove from here. But we need target folder.
          // For label edit, this is enough.
          updated = true;
          const newBookmarks = [...f.bookmarks];
          newBookmarks[idx] = newB;
          return { ...f, bookmarks: newBookmarks };
        }
        return f;
      });

      if (updated) {
        this.folders.set(newFolders);
      } else {
        // Check loose bookmarks
        this.looseBookmarks.update(bookmarks => {
          return bookmarks.map(b => b.id === idOrKey ? { ...b, ...updates } : b);
        });
      }

      // Try by ID first
      if (this.bookmarks().some(b => b.id === idOrKey)) {
        this.http.put(`${this.apiUrl}/${idOrKey}`, updates)
          .pipe(
            catchError(err => {
              console.error('Failed to update bookmark', err);
              this.fetchCloud(); // Revert/Sync on error
              return of(null);
            })
          )
          .subscribe(() => this.fetchCloud());
        return; // Cloud update initiated
      }
    }

    // Local update fallback
    const current = this.bookmarks();
    const index = current.findIndex(b => b.id === idOrKey || b.key === idOrKey);

    if (index !== -1) {
      const b = current[index];
      const newB = { ...b, ...updates };
      // Map folderId to folder name if local
      if (updates.folderId) {
        newB.folder = updates.folderId;
      }

      const newBookmarks = [...current];
      newBookmarks[index] = newB;

      this.saveLocal(newBookmarks);
    }
  }


  // --- Internal Helpers ---

  private fetchCloud() {
    this.http.get<{ folders: Folder[], bookmarks: Bookmark[] }>(this.apiUrl)
      .pipe(
        tap(res => {
          const folders = res.folders.map(f => ({ ...f }));
          const loose = res.bookmarks; // bookmarks without folder_id

          if (loose.length > 0) {
            // Attach loose bookmarks to the real "Harian" folder if it exists
            const harianIndex = folders.findIndex(f => f.name === 'Harian');
            if (harianIndex !== -1) {
              folders[harianIndex].bookmarks = [...folders[harianIndex].bookmarks, ...loose];
              this.looseBookmarks.set([]);
            } else {
              // No Harian exists in DB — keep loose bookmarks visible outside folders
              this.looseBookmarks.set(loose);
            }
          } else {
            this.looseBookmarks.set([]);
          }

          this.folders.set(folders);
        }),
        catchError(err => {
          console.error('Failed to sync bookmarks', err);
          return of(null);
        })
      ).subscribe();
  }

  private loadLocal(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        let flat: Bookmark[] = JSON.parse(raw);
        let migrated = false;

        // Migration: Umum -> Harian
        flat = flat.map(b => {
          if (!b.folder || b.folder === 'Umum') {
            migrated = true;
            return { ...b, folder: 'Harian' };
          }
          return b;
        });

        if (migrated) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(flat));
        }

        // Convert flat list to virtual folders for consistency
        const folderMap = new Map<string, Folder>();
        const loose: Bookmark[] = [];

        flat.forEach(b => {
          if (b.folder) { // All should have folder now
            if (!folderMap.has(b.folder)) {
              folderMap.set(b.folder, { id: b.folder, name: b.folder, bookmarks: [] });
            }
            folderMap.get(b.folder)!.bookmarks.push(b);
          } else {
            loose.push(b);
          }
        });

        // Ensure "Harian" exists even if empty? Local logic deduces from bookmarks.
        // If map is empty and loose is empty, both empty.

        this.folders.set(Array.from(folderMap.values()));
        this.looseBookmarks.set(loose);
      } else {
        this.folders.set([]);
        this.looseBookmarks.set([]);
      }
    } catch {
      this.folders.set([]);
      this.looseBookmarks.set([]);
    }
  }

  private saveLocal(bookmarks: Bookmark[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
    this.loadLocal(); // Refresh state
  }
}
