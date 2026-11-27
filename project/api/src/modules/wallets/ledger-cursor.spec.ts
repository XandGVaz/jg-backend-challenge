import { describe, expect, it } from 'bun:test';
import { RequestValidationError } from '../../shared/errors/request-validation.error.js';
import { decodeLedgerCursor, encodeLedgerCursor } from './ledger-cursor.js';

const id = '0192f2a0-0000-7000-8000-000000000001';

describe('ledger cursor', () => {
  it('round-trips createdAt and id', () => {
    const createdAt = new Date('2026-11-27T10:00:00.123Z');
    const decoded = decodeLedgerCursor(encodeLedgerCursor({ createdAt, id }));

    expect(decoded).toEqual({ createdAt, id });
  });

  it('is base64url, safe for a query string', () => {
    expect(encodeLedgerCursor({ createdAt: new Date(), id })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects garbage, unknown versions and invalid fields with a 400 on cursor', () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

    for (const raw of [
      'not-a-cursor',
      encode({ v: 2, createdAt: new Date().toISOString(), id }),
      encode({ v: 1, createdAt: 'yesterday', id }),
      encode({ v: 1, createdAt: new Date().toISOString(), id: 'x' }),
    ]) {
      const error = (() => {
        try {
          decodeLedgerCursor(raw);
        } catch (caught) {
          return caught;
        }
        return undefined;
      })();

      expect(error).toBeInstanceOf(RequestValidationError);
      expect((error as RequestValidationError).details[0]?.path).toBe('cursor');
    }
  });
});
