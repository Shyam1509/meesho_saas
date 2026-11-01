import { TestBed } from '@angular/core/testing';

import { FileSaverService } from './file-saver.service';

describe('FileSaverService', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('clicks a temporary <a download> on an object URL, removes it, and revokes the URL later', () => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/1');
    URL.revokeObjectURL = vi.fn();
    const clicked: { href: string; download: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
    });

    const blob = new Blob(['a,b\r\n'], { type: 'text/csv' });
    TestBed.inject(FileSaverService).save(blob, 'Main-store-orders.csv');

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([
      { href: 'blob:http://localhost/1', download: 'Main-store-orders.csv', attached: true },
    ]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/1');
  });
});
