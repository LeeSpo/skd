import { afterEach, describe, expect, it } from 'vitest';
import {
  clearComposeDraft,
  loadComposeDraft,
  saveComposeDraft,
} from '../compose-draft-storage';

describe('compose-draft-storage', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('returns empty string when no draft exists', () => {
    expect(loadComposeDraft('conn-a')).toBe('');
  });

  it('isolates drafts per connection id', () => {
    saveComposeDraft('conn-a', 'alpha');
    saveComposeDraft('conn-b', 'beta');

    expect(loadComposeDraft('conn-a')).toBe('alpha');
    expect(loadComposeDraft('conn-b')).toBe('beta');
  });

  it('clears draft storage', () => {
    saveComposeDraft('conn-a', 'alpha');
    clearComposeDraft('conn-a');
    expect(loadComposeDraft('conn-a')).toBe('');
  });

  it('removes key when saving empty draft', () => {
    saveComposeDraft('conn-a', 'alpha');
    saveComposeDraft('conn-a', '');
    expect(sessionStorage.getItem('skd-compose-draft-conn-a')).toBeNull();
  });
});