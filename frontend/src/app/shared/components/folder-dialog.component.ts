import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-folder-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="modal-content" (click)="$event.stopPropagation()">
        <h3>{{ isEdit() ? 'Ubah Nama Folder' : 'Folder Baru' }}</h3>
        
        <div class="form-group">
          <label>Nama Folder</label>
          <input 
            type="text" 
            [ngModel]="name()" 
            (ngModelChange)="name.set($event)"
            placeholder="Masukkan nama folder..." 
            (keyup.enter)="onSubmit()"
            autofocus
          />
        </div>

        <div class="actions">
          <button (click)="close.emit()" class="cancel-btn">Batal</button>
          <button (click)="onSubmit()" class="save-btn" [disabled]="!name()?.trim()">
            Simpan
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .modal-content {
      background: var(--bg-primary);
      padding: 24px;
      border-radius: 24px;
      width: 90%;
      max-width: 400px;
      box-shadow: var(--shadow-medium);
    }
    h3 { margin-bottom: 16px; color: var(--text-primary); }
    .form-group {
      margin-bottom: 16px;
      label { display: block; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary); }
      input {
        width: 100%;
        padding: 12px;
        border: 1px solid var(--bg-tertiary);
        border-radius: 12px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 14px;
        &:focus { outline: 2px solid var(--cyan-primary); border-color: transparent; }
      }
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 24px;
      button {
        padding: 12px 24px;
        border-radius: 9999px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        font-size: 14px;
      }
      .cancel-btn { background: var(--bg-tertiary); color: var(--text-primary); }
      .save-btn { background: var(--cyan-primary); color: var(--text-primary); &:disabled { opacity: 0.7; } }
    }
  `
})
export class FolderDialogComponent {
  initialName = input('');
  isEdit = input(false);

  save = output<string>();
  close = output<void>();

  name = signal('');

  constructor() {
    // Ideally initialize in effect or ngOnInit, but signal update directly works if initialName is provided
    // For simplicity, we can set default in ngOnInit
  }

  ngOnInit() {
    // If editing, use initial name. If creating, empty.
    // Line 87: initialName = input('');
    // So for create, it's ''.
    this.name.set(this.initialName());
  }

  onSubmit() {
    const val = this.name().trim();
    if (val) {
      this.save.emit(val);
    }
  }
}
