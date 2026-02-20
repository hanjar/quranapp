export interface Bookmark {
  id?: string;        // UUID (backend)
  key: string;        // "2:255" (frontend/local key)
  surah: number;
  ayah: number;
  surahNameAr: string;
  surahNameEn: string;
  folder?: string;    // Legacy/Local folder name (e.g. "Umum")
  folderId?: string;  // Backend folder ID
  label?: string;     // User label
  createdAt: string;
}

export interface Folder {
  id: string;
  name: string;
  bookmarks: Bookmark[];
  createdAt?: string;
}
