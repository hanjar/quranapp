import { Component, inject, input, output, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common'; // visual feedback said it might be needed, adding it to imports
import { QuranDataService } from '../../core/services/quran-data.service';
import { BookmarkService } from '../../core/services/bookmark.service';
import { DownloadService } from '../../core/services/download.service';
import { AuthService } from '../../core/services/auth.service';
import { ArabicNumberPipe } from '../pipes/arabic-number.pipe';
import { Bookmark } from '../../core/models/bookmark.model';
import { AuthDialogComponent } from '../../features/auth/auth-dialog.component';

import { BookmarkModalComponent } from './bookmark-modal.component';
import { FolderDialogComponent } from './folder-dialog.component';

@Component({
  selector: 'app-surah-list',
  standalone: true,
  imports: [CommonModule, ArabicNumberPipe, AuthDialogComponent, BookmarkModalComponent, FolderDialogComponent],
  template: `
    <div class="surah-list-panel" [class.open]="open()">
      <div class="panel-backdrop" (click)="close.emit()"></div>
      <div class="panel-content">
        <div class="panel-header">
           <!-- User Profile / Login -->
           <div class="user-section">
             @if (authService.currentUser(); as user) {
               <div class="user-profile">
                 <img [src]="user.picture || 'https://www.gravatar.com/avatar?d=mp'" 
                      class="avatar" 
                      alt="Avatar"
                      (error)="handleImageError($event)">
                 <div class="user-info">
                   <span class="user-name">{{ user.name || user.email }}</span>
                   <button (click)="authService.logout()" class="logout-link">Keluar</button>
                 </div>
               </div>
             } @else {
               <button (click)="showAuthDialog.set(true)" class="login-btn">
                 Masuk / Daftar
               </button>
             }
           </div>

           <button class="close-btn" (click)="close.emit()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- Tabs -->
        <div class="tabs-container">
          <!-- Hidden SVG for Gradient Definitions -->
          <svg style="width:0;height:0;position:absolute;" aria-hidden="true" focusable="false">
            <linearGradient id="tab-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#40E0D0" /> <!-- Light cyan/teal -->
              <stop offset="100%" stop-color="#14B8A6" /> <!-- Deeper teal -->
            </linearGradient>
          </svg>

          <div class="tabs">
            <button
              class="tab-btn"
              [class.active]="activeTab() === 'surah'"
              (click)="activeTab.set('surah')"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="tab-icon" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
              <span>Surah</span>
            </button>
            <button
              class="tab-btn"
              [class.active]="activeTab() === 'bookmark'"
              (click)="activeTab.set('bookmark')"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="tab-icon" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path></svg>
              <span>Penanda</span>
            </button>
            <button
              class="tab-btn"
              [class.active]="activeTab() === 'offline'"
              (click)="activeTab.set('offline')"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="tab-icon" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5V19A9 3 0 0 0 21 19V5"></path><path d="M3 12A9 3 0 0 0 21 12"></path></svg>
              <span>Offline</span>
            </button>
          </div>
        </div>

        <div class="panel-body">
          @if (activeTab() === 'surah') {
            @for (surah of quranData.surahs(); track surah.number) {
              <button
                class="surah-item"
                [class.active]="surah.number === currentSurah()"
                (click)="selectSurah.emit(surah.number)"
              >
                <span class="surah-num">{{ surah.number }}</span>
                <div class="surah-details">
                  <span class="surah-name-ar arabic-ui">{{ surah.name }}</span>
                  <span class="surah-name-en latin-ui">{{ surah.englishName }}</span>
                </div>
                <span class="surah-ayat latin-ui">{{ surah.totalVerses | arabicNumber }} ayat</span>
              </button>
            }
          } @else if (activeTab() === 'bookmark') {
             <div class="bookmark-actions">
               <button class="action-btn small" (click)="openCreateFolder()">+ Folder Baru</button>
             </div>

             @if (bookmarkService.folders().length === 0 && bookmarkService.looseBookmarks().length === 0) {
               <div class="empty-state latin-ui">
                 <p>Belum ada penanda.</p>
                 <small>Tekan ayat untuk menambahkan penanda.</small>
               </div>
             } @else {
               <!-- Folders -->
               @for (folder of bookmarkService.folders(); track folder.id) {
                 <div class="folder-group">
                   <div class="folder-header" (click)="toggleFolder(folder.id)">
                     <span class="folder-icon">
                       <svg [class.rotated]="isFolderOpen(folder.id)" class="chevron-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                     </span>
                     <span class="folder-name">{{ folder.name }}</span>
                     <div class="folder-actions" (click)="$event.stopPropagation()">
                       <button (click)="openRenameFolder(folder.id, folder.name)" title="Ubah Nama">
                         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                       </button>
                       @if (folder.name !== 'Harian') {
                         <button class="delete-folder-btn" (click)="removeFolder(folder.id)" title="Hapus Folder">
                           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                         </button>
                       }
                     </div>
                   </div>
                  
                  @if (isFolderOpen(folder.id)) {
                    <div class="folder-content">
                       @if (folder.bookmarks.length === 0) {
                         <div class="empty-folder">Folder kosong</div>
                       }
                       @for (b of folder.bookmarks; track b.key) {
                         <div class="bookmark-item nested">
                           <button class="bookmark-content" (click)="onBookmarkClick(b)">
                             <div class="bookmark-details">
                               <div class="bookmark-header">
                                 <span class="bookmark-surah arabic-ui">{{ b.surahNameAr }}</span>
                                 @if (b.label) { <span class="bookmark-label">📝 {{ b.label }}</span> }
                               </div>
                               <div class="bookmark-ref latin-ui">
                                 <span>Surah {{ b.surah }} ({{ b.surahNameEn }}) : {{ b.ayah }}</span>
                                 <div class="bookmark-meta">
                                   <span class="bookmark-page">Juz {{ b.juz || '-' }} &bull; Hal. {{ b.page }}</span>
                                   <span class="bookmark-date">{{ formatDate(b.createdAt) }}</span>
                                 </div>
                               </div>
                             </div>
                           </button>
                            <div class="item-actions">
                              <button class="action-btn-circle" (click)="onBookmarkClick(b)" title="Pergi ke Penanda">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 16 16 12 12 8"></polyline><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                              </button>
                              <button class="action-btn-circle" (click)="editBookmark(b)" title="Edit Label/Pindah">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                              </button>
                              <button class="action-btn-circle delete" (click)="deleteBookmark(b.key)" title="Hapus">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                              </button>
                            </div>
                         </div>
                       }
                    </div>
                  }
                </div>
              }

              <!-- Loose Bookmarks -->
              @if (bookmarkService.looseBookmarks().length > 0) {
                <div class="loose-bookmarks-header">Tanpa Folder</div>
                @for (b of bookmarkService.looseBookmarks(); track b.key) {
                  <div class="bookmark-item">
                    <button class="bookmark-content" (click)="onBookmarkClick(b)">
                      <div class="bookmark-icon">🔖</div>
                      <div class="bookmark-details">
                         <div class="bookmark-header">
                           <span class="bookmark-surah arabic-ui">{{ b.surahNameAr }}</span>
                           @if (b.label) { <span class="bookmark-label">📝 {{ b.label }}</span> }
                         </div>
                         <div class="bookmark-ref latin-ui">
                           <span>Surah {{ b.surah }} ({{ b.surahNameEn }}) : {{ b.ayah }}</span>
                           <div class="bookmark-meta">
                             <span class="bookmark-page">Juz {{ b.juz || '-' }} &bull; Hal. {{ b.page }}</span>
                             <span class="bookmark-date">{{ formatDate(b.createdAt) }}</span>
                           </div>
                         </div>
                      </div>
                    </button>
                    <div class="item-actions">
                      <button class="action-btn-circle" (click)="onBookmarkClick(b)" title="Pergi ke Penanda">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 16 16 12 12 8"></polyline><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                      </button>
                      <button class="action-btn-circle" (click)="editBookmark(b)" title="Edit Label/Pindah">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                      </button>
                      <button class="action-btn-circle delete" (click)="deleteBookmark(b.key)" title="Hapus">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                    </div>
                  </div>
                }
              }
            }
          } @else if (activeTab() === 'offline') {
            <div class="offline-panel latin-ui">
              <h3>Mode Offline</h3>
              <p>Unduh seluruh data mushaf (teks & font) agar aplikasi dapat digunakan tanpa internet.</p>
              
              <div class="download-status">
                @if (downloadService.state().downloading) {
                  <div class="progress-info">
                    <span>Mengunduh... {{ downloadService.state().progress }}%</span>
                    <span>{{ downloadService.state().current }} / {{ downloadService.state().total }}</span>
                  </div>
                  <div class="progress-bar">
                    <div class="progress-fill" [style.width.%]="downloadService.state().progress"></div>
                  </div>
                  <button class="action-btn cancel-btn" (click)="downloadService.cancelDownload()">
                    Batal
                  </button>
                } @else {
                  @if (downloadService.state().completed) {
                    <div class="success-msg">
                      ✅ Data offline tersedia.
                      @if (getLastUpdate()) { <div class="last-update">Diupdate: {{ getLastUpdate() }}</div> }
                    </div>
                    
                    <button class="action-btn download-btn secondary" (click)="downloadService.startDownload()">
                      Update Data Mushaf (~50MB)
                    </button>
                  } @else {
                    @if (downloadService.state().error) {
                      <div class="error-msg">
                        ❌ {{ downloadService.state().error }}
                      </div>
                    }

                    <button class="action-btn download-btn" (click)="downloadService.startDownload()">
                      Download Data Mushaf (~50MB)
                    </button>
                    <p class="note">Tidak termasuk audio.</p>
                  }
                }
              </div>
            </div>
          }
        </div>
      </div>
    </div>

    @if (showAuthDialog()) {
      <app-auth-dialog (onClose)="showAuthDialog.set(false)" />
    }

    @if (activeFolderDialog(); as dialog) {
      <app-folder-dialog 
        [isEdit]="dialog.type === 'rename'"
        [initialName]="dialog.currentName || ''"
        (save)="onFolderSubmit($event)"
        (close)="activeFolderDialog.set(null)"
      />
    }

    @if (editingBookmark(); as b) {
      <app-bookmark-modal 
        [bookmark]="b"
        [surah]="b.surah"
        [ayah]="b.ayah"
         [surahNameAr]="b.surahNameAr"
         [surahNameEn]="b.surahNameEn"
         [page]="b.page || 0"
         (close)="onEditClose()"
      />
    }
  `,
  styles: `
    .surah-list-panel {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 200;
      pointer-events: none;
      &.open {
        pointer-events: all;
        .panel-backdrop { opacity: 1; }
        .panel-content { transform: translateX(0); }
      }
    }
    .panel-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      opacity: 0;
      transition: opacity 0.3s;
    }
    .panel-content {
      position: absolute;
      top: 0;
      left: 0;
      width: min(400px, 92vw);
      height: 100%;
      background: var(--bg-primary);
      box-shadow: var(--shadow-medium);
      transform: translateX(-100%);
      transition: transform 0.3s ease;
      display: flex;
      flex-direction: column;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border-bottom: 1px solid var(--bg-tertiary);
      background: var(--bg-secondary);
    }
    .user-section {
       flex: 1;
    }
    .user-profile {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
      border: 1px solid var(--gold-primary);
    }
    .user-info {
      display: flex;
      flex-direction: column;
    }
    .user-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
    }
    .logout-link {
      font-size: 11px;
      color: #c0392b;
      text-align: left;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      &:hover { text-decoration: underline; }
    }
    .login-btn {
      padding: 10px 16px;
      background: var(--cyan-primary);
      color: var(--text-primary);
      border: none;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      &:hover { background: var(--cyan-dark); color: white; }
    }

    .tabs-container {
      padding: 12px 16px;
      border-bottom: 1px solid var(--bg-tertiary);
    }
    .tabs {
      display: flex;
      gap: 4px;
      background: var(--bg-tertiary);
      padding: 4px;
      border-radius: 9999px;
    }
    .tab-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      border: none;
      background: transparent;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.2s;

      &.active {
        background: var(--bg-secondary);
        color: var(--text-primary);
        box-shadow: var(--shadow-soft);
        
        // Only the text and the icon should have the gradient effect.
        span {
          background: var(--gradient-card);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          color: transparent; 
        }

        .tab-icon {
          stroke: url(#tab-gradient);
        }
      }
    }
    .close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      border-radius: 8px;
      cursor: pointer;
      &:hover { background: rgba(0,0,0,0.05); }
    }
    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }
    .surah-item {
      display: flex;
      align-items: center;
      gap: 12px;
      width: calc(100% - 32px);
      margin: 8px 16px;
      padding: 16px;
      border: 1px solid transparent;
      border-radius: 16px;
      background: var(--bg-secondary);
      box-shadow: var(--shadow-soft);
      cursor: pointer;
      text-align: left;
      transition: transform 0.2s, box-shadow 0.2s, border 0.2s;
      &:hover { transform: translateY(-2px); box-shadow: var(--shadow-medium); }
      &.active {
        background: var(--bg-secondary);
        border: 1px solid var(--cyan-primary);
        box-shadow: 0 0 0 2px rgba(0, 229, 255, 0.1);
      }
    }
    .surah-num {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(0, 229, 255, 0.08);
      border: 1px dashed var(--cyan-primary);
      font-size: 13px;
      font-weight: 600;
      color: var(--cyan-dark);
      flex-shrink: 0;
    }
    .surah-details {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .surah-name-ar {
      font-size: 18px;
      color: var(--text-primary);
    }
    .surah-name-en {
      color: var(--text-muted);
    }
    .surah-ayat {
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .bookmark-item {
      display: flex;
      align-items: center;
      width: calc(100% - 32px);
      margin: 8px 16px;
      padding: 16px;
      border-radius: 16px;
      background: var(--bg-secondary);
      box-shadow: var(--shadow-soft);
      border-bottom: none;
      position: relative;
      flex-direction: column;
      align-items: stretch;
      transition: transform 0.2s, box-shadow 0.2s;
      &:hover { transform: translateY(-2px); box-shadow: var(--shadow-medium); }
    }
    .bookmark-content {
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: transparent;
      border: none;
      text-align: left;
      cursor: pointer;
      padding: 0;
      width: 100%;
    }
    .bookmark-icon {
      font-size: 18px;
      padding-top: 2px;
    }
    .bookmark-details {
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
    }
    .bookmark-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }
    .bookmark-surah {
      font-size: 18px;
      color: var(--text-primary);
    }
    .bookmark-ref {
      font-size: 12px;
      font-weight: 500;
      color: var(--gold-dark);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .bookmark-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 2px;
    }
    .bookmark-page {
      font-size: 11px;
      color: var(--text-muted);
      font-weight: normal;
    }
    .bookmark-date {
      font-size: 11px;
      color: var(--text-muted);
    }
    .item-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      width: 100%;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--bg-tertiary);
    }
    .action-btn-circle {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(0, 229, 255, 0.08);
      color: var(--cyan-dark);
      border: 1px solid rgba(0, 229, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
      &:hover {
        background: var(--cyan-primary);
        color: white;
      }
      &.delete {
        background: rgba(239, 68, 68, 0.05);
        color: #ef4444;
        border-color: rgba(239, 68, 68, 0.1);
        &:hover {
          background: #ef4444;
          color: white;
        }
      }
    }
    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: var(--text-muted);
      p { margin-bottom: 8px; font-weight: 500; }
      small { font-size: 12px; opacity: 0.8; }
    }
    /* Offline Panel */
    .offline-panel {
      padding: 24px 20px;
      color: var(--text-primary);
      text-align: center;
      h3 { margin-bottom: 8px; color: var(--text-primary); }
      p { margin-bottom: 24px; color: var(--text-secondary); font-size: 14px; line-height: 1.5; }
    }
    .action-btn {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      font-size: 14px;
      transition: opacity 0.2s;
      &:hover { opacity: 0.9; }
    }
    .download-btn {
      background: var(--gradient-card);
      color: white;
    }
    .cancel-btn {
      background: #ef4444;
      color: white;
      margin-top: 12px;
    }
    .note {
      margin-top: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .progress-info {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 8px;
      color: var(--text-secondary);
      font-weight: 500;
    }
    .progress-bar {
      height: 8px;
      background: var(--bg-tertiary);
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--gold-primary);
      transition: width 0.3s ease;
    }
    .success-msg {
      padding: 12px;
      background: rgba(34, 197, 94, 0.1);
      color: #15803d;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 14px;
      font-weight: 500;
    }
    .last-update {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
      font-weight: normal;
    }
    .download-btn.secondary {
      background: transparent;
      border: 1px solid var(--gold-dark);
      color: var(--gold-dark);
      &:hover { background: rgba(0, 184, 212, 0.05); }
    }
    .error-msg {
       padding: 12px;
      background: rgba(239, 68, 68, 0.1);
      color: #b91c1c;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 14px; 
    }

    /* Folders */
    .folder-group {
      margin-bottom: 8px;
    }
    .folder-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: var(--bg-tertiary);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
      color: var(--text-primary);
      &:hover { background: rgba(0,0,0,0.08); }
    }
    .folder-icon { font-size: 16px; }
    .folder-name { flex: 1; }
    .folder-actions {
      display: flex;
      gap: 4px;
      button {
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 14px;
        opacity: 0.6;
        padding: 4px;
        border-radius: 4px;
        &:hover { opacity: 1; transform: scale(1.1); }
      }
      .delete-folder-btn {
        color: #ef4444;
        &:hover { background: rgba(239, 68, 68, 0.1); }
      }
    }
    .folder-content {
      margin-top: 4px;
      margin-left: 12px;
      padding-left: 12px;
      border-left: 2px solid var(--bg-tertiary);
    }
    .empty-folder {
      padding: 8px;
      font-size: 12px;
      color: var(--text-muted);
      font-style: italic;
    }
    .bookmark-item.nested {
      padding: 16px;
      border-bottom: none;
      margin-bottom: 4px;
      width: calc(100% - 32px);
      margin-left: 0;
      margin-right: 0;
    }
    .bookmark-label {
      font-size: 11px;
      background: rgba(0, 229, 255, 0.1);
      padding: 4px 8px;
      border-radius: 9999px;
      color: var(--cyan-dark);
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 140px;
    }
    .loose-bookmarks-header {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      margin: 16px 0 8px 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .bookmark-actions {
      padding: 8px 16px;
      border-bottom: 1px solid var(--bg-tertiary);
    }
    .action-btn.small {
      padding: 6px 12px;
      font-size: 12px;
      width: auto;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      &:hover { background: rgba(0,0,0,0.1); }
    }
    .chevron-icon { transition: transform 0.2s; color: var(--text-muted); }
    .rotated { transform: rotate(90deg); }
  `,
})
export class SurahListComponent {
  quranData = inject(QuranDataService);
  bookmarkService = inject(BookmarkService);
  downloadService = inject(DownloadService);
  authService = inject(AuthService);

  open = input(false);
  currentSurah = input(1);
  close = output<void>();
  selectSurah = output<number>();
  selectBookmark = output<Bookmark>();

  activeTab = signal<'surah' | 'bookmark' | 'offline'>('surah');
  showAuthDialog = signal(false);

  onBookmarkClick(bookmark: Bookmark) {
    this.selectBookmark.emit(bookmark);
  }

  deleteBookmark(key: string) {
    if (confirm('Hapus penanda ini?')) {
      this.bookmarkService.remove(key);
    }
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    // SQLite returns "YYYY-MM-DD HH:MM:SS" — normalize to ISO 8601 for reliable parsing
    const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }


  handleImageError(event: any) {
    event.target.src = 'https://www.gravatar.com/avatar?d=mp';
  }

  expandedFolders = signal<Set<string>>(new Set());

  toggleFolder(id: string) {
    this.expandedFolders.update(set => {
      const newSet = new Set(set);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  }

  isFolderOpen(id: string): boolean {
    return this.expandedFolders().has(id);
  }

  // State for modals
  activeFolderDialog = signal<{ type: 'create' | 'rename', id?: string, currentName?: string } | null>(null);
  editingBookmark = signal<Bookmark | null>(null);

  // Folder Actions
  openCreateFolder() {
    this.activeFolderDialog.set({ type: 'create' });
  }

  openRenameFolder(id: string, current: string) {
    this.activeFolderDialog.set({ type: 'rename', id, currentName: current });
  }

  onFolderSubmit(name: string) {
    const dialog = this.activeFolderDialog();
    if (!dialog) return;

    if (dialog.type === 'create') {
      this.bookmarkService.createFolder(name);
    } else if (dialog.type === 'rename' && dialog.id) {
      if (name !== dialog.currentName) {
        this.bookmarkService.renameFolder(dialog.id, name);
      }
    }
    this.activeFolderDialog.set(null);
  }

  // Bookmark Actions
  editBookmark(b: Bookmark) {
    this.editingBookmark.set(b);
  }

  onEditClose() {
    this.editingBookmark.set(null);
  }

  removeFolder(id: string) {
    if (confirm('Hapus folder dan isinya?')) {
      this.bookmarkService.deleteFolder(id);
    }
  }

  // ... (existing helper methods)

  // ... (existing helper methods)

  getLastUpdate(): string | null {
    const date = localStorage.getItem('mushaf_downloaded_date');
    if (!date) return null;
    return new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
