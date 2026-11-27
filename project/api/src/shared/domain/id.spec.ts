import { describe, expect, it, spyOn } from 'bun:test';
import { newId } from './id.js';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('creates UUIDs with RFC 9562 version and variant bits', () => {
    const ids = Array.from({ length: 100 }, () => newId());

    for (const id of ids) {
      expect(id).toMatch(UUID_V7_PATTERN);
      expect(id[14]).toBe('7');
      expect(Number.parseInt(id[19], 16) & 0xc).toBe(0x8);
    }
  });

  it('is unique and lexicographically monotonic within the same millisecond', () => {
    const now = Date.now() + 10_000;
    const clock = spyOn(Date, 'now').mockReturnValue(now);

    try {
      const ids = Array.from({ length: 512 }, () => newId());

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual([...ids].sort());
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps ordering when the system clock moves backwards', () => {
    const now = Date.now() + 20_000;
    const clock = spyOn(Date, 'now').mockReturnValue(now);

    try {
      const first = newId();
      clock.mockReturnValue(now - 1_000);
      const second = newId();

      expect(second > first).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
});
