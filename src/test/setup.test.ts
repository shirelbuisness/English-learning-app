import { describe, expect, it } from 'vitest';

describe('test environment', () => {
  it('provides IndexedDB via fake-indexeddb', () => {
    expect(globalThis.indexedDB).toBeDefined();
    expect(typeof globalThis.indexedDB.open).toBe('function');
  });
});
