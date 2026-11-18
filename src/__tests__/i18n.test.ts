import i18n from '../lib/i18n';
import { describe, it, expect } from 'vitest';

describe('i18n', () => {
  it('should handle pluralization', () => {
    const single = i18n.t('fileBrowser.toast.queuedUpload', { count: 1 });
    const plural = i18n.t('fileBrowser.toast.queuedUpload', { count: 5 });
    expect(single).toContain('1 file');
    expect(plural).toContain('5 files');
  });
});