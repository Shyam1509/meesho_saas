import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';

import { FileSizePipe } from '../format/format.pipes';
import { formatFileSize } from '../format/format';

/**
 * Why `file` cannot be used, or `null` when it can: the extension must be one of `accept`
 * (case-insensitive; browsers report unreliable MIME types for CSV), and the size 1..`maxBytes`.
 */
export function checkFile(file: File, accept: readonly string[], maxBytes: number): string | null {
  const name = file.name;
  const lower = name.toLowerCase();
  if (accept.length > 0 && !accept.some((ext) => lower.endsWith(ext.toLowerCase()))) {
    return `“${name}” is not a ${listExtensions(accept)} file. Choose a ${listExtensions(accept)} file.`;
  }
  if (file.size === 0) {
    return `“${name}” is empty. Choose a file that contains the report.`;
  }
  if (file.size > maxBytes) {
    return `“${name}” is larger than ${formatFileSize(maxBytes)}. Choose a smaller file.`;
  }
  return null;
}

/** `['.csv', '.xlsx']` → ".csv or .xlsx". */
function listExtensions(accept: readonly string[]): string {
  if (accept.length <= 1) {
    return accept[0] ?? '';
  }
  return `${accept.slice(0, -1).join(', ')} or ${accept[accept.length - 1]}`;
}

/**
 * File picker with a drag-and-drop area. The control is the native `<input type="file">` (visually
 * hidden, so keyboard users Tab to it and open the picker with Enter or Space; the area shows its
 * focus ring); the visible area is its label, so a click anywhere in it opens the picker too.
 * A chosen or dropped file is checked with {@link checkFile}; a rejected one is never set.
 */
@Component({
  selector: 'app-file-drop-zone',
  imports: [FileSizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <input
      #fileInput
      type="file"
      class="peer sr-only"
      [id]="inputId()"
      [accept]="accept().join(',')"
      [disabled]="disabled()"
      [attr.aria-invalid]="shownError() ? 'true' : null"
      [attr.aria-describedby]="describedBy()"
      (change)="onInputChange($event)"
    />
    <label
      [for]="inputId()"
      class="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-600"
      [class]="
        dragging()
          ? 'border-accent-600 bg-accent-50'
          : shownError()
            ? 'border-red-400 bg-white'
            : 'border-slate-300 bg-white hover:border-slate-400'
      "
      [class.cursor-pointer]="!disabled()"
      [class.opacity-60]="disabled()"
      [attr.data-dragging]="dragging() ? 'true' : null"
      (dragenter)="onDragOver($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave()"
      (drop)="onDrop($event)"
    >
      <span class="font-medium text-slate-900">{{ label() }}</span>
      <span class="text-slate-600">
        Drag and drop the file here, or
        <span class="font-medium text-accent-700 underline">choose a file</span>.
      </span>
    </label>
    @if (hint()) {
      <p [id]="inputId() + '-hint'" class="mt-1 text-xs text-slate-600">{{ hint() }}</p>
    }
    @if (file(); as chosen) {
      <div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <p [id]="inputId() + '-selected'" class="text-slate-800">
          Selected: <span class="font-medium break-all">{{ chosen.name }}</span
          ><span class="text-slate-600"> ({{ chosen.size | fileSize }})</span>
        </p>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          [attr.aria-disabled]="disabled() ? 'true' : null"
          (click)="remove()"
        >
          Remove<span class="sr-only"> {{ chosen.name }}</span>
        </button>
      </div>
    }
    <div aria-live="polite">
      @if (shownError(); as message) {
        <p [id]="inputId() + '-error'" class="mt-1 text-sm text-red-700">{{ message }}</p>
      }
    </div>
  `,
})
export class FileDropZone {
  readonly inputId = input.required<string>();
  /** Visible text of the area; also the input's accessible name. */
  readonly label = input.required<string>();
  /** Allowed extensions, with the dot (`['.csv', '.xlsx']`); empty allows any. */
  readonly accept = input<readonly string[]>([]);
  readonly maxBytes = input(Number.MAX_SAFE_INTEGER);
  readonly hint = input('');
  readonly disabled = input(false);
  /** An error from the parent (e.g. "choose a file" on submit); a rejected file's reason wins. */
  readonly error = input<string | null>(null);

  /** The accepted file, two-way bindable. */
  readonly file = model<File | null>(null);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly dragging = signal(false);
  protected readonly rejection = signal<string | null>(null);
  protected readonly shownError = computed(() => this.rejection() ?? this.error());
  protected readonly describedBy = computed(() => {
    const id = this.inputId();
    const ids = [
      this.hint() ? `${id}-hint` : null,
      this.file() ? `${id}-selected` : null,
      this.shownError() ? `${id}-error` : null,
    ].filter((value): value is string => value !== null);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  focus(): void {
    this.fileInput().nativeElement.focus();
  }

  /** Forgets the file and any rejection (e.g. after a successful upload). */
  clear(): void {
    this.file.set(null);
    this.rejection.set(null);
    this.fileInput().nativeElement.value = '';
  }

  protected onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files && files.length > 0) {
      this.take(Array.from(files));
    }
    // Lets the same file be chosen again after it was removed or rejected.
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    // Without preventDefault the browser would open the file instead of dropping it here.
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = this.disabled() ? 'none' : 'copy';
    }
    if (!this.disabled()) {
      this.dragging.set(true);
    }
  }

  protected onDragLeave(): void {
    this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.disabled()) {
      return;
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      this.take(files);
    }
  }

  protected remove(): void {
    if (this.disabled()) {
      return;
    }
    this.clear();
    this.focus();
  }

  private take(files: File[]): void {
    if (files.length > 1) {
      this.rejection.set('Choose one file at a time.');
      this.file.set(null);
      return;
    }
    const problem = checkFile(files[0], this.accept(), this.maxBytes());
    this.rejection.set(problem);
    this.file.set(problem === null ? files[0] : null);
  }
}
