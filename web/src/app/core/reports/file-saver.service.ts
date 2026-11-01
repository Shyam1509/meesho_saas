import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** How long the object URL of a saved file stays valid (the browser has started the save by then). */
const REVOKE_AFTER_MS = 30_000;

/**
 * Hands a downloaded file to the browser's "save" flow through a temporary object URL and a
 * hidden `<a download>`. A separate service so specs can replace it (jsdom has no object URLs).
 */
@Injectable({ providedIn: 'root' })
export class FileSaverService {
  private readonly document = inject(DOCUMENT);

  save(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    this.document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}
