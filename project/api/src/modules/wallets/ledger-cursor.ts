import { RequestValidationError } from '../../shared/errors/request-validation.error.js';

export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Cursor opaco e versionado do ledger: base64url de `{ v: 1, createdAt, id }` (api.md §9.2). */
export function encodeLedgerCursor(cursor: LedgerCursor): string {
  const payload = { v: 1, createdAt: cursor.createdAt.toISOString(), id: cursor.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Cursor inválido ou de versão desconhecida é entrada do cliente: 400 com path `cursor`. */
export function decodeLedgerCursor(raw: string): LedgerCursor {
  const parsed = parseJson(Buffer.from(raw, 'base64url').toString('utf8'));

  if (typeof parsed !== 'object' || parsed === null) {
    throw invalidCursor('Cursor is not an object');
  }

  const { v, createdAt, id } = parsed as Record<string, unknown>;

  if (v !== 1) {
    throw invalidCursor('Unknown cursor version');
  }

  if (typeof id !== 'string' || !UUID.test(id)) {
    throw invalidCursor('Cursor id is invalid');
  }

  const date = typeof createdAt === 'string' ? new Date(createdAt) : new Date(Number.NaN);

  if (Number.isNaN(date.getTime())) {
    throw invalidCursor('Cursor createdAt is invalid');
  }

  return { createdAt: date, id };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function invalidCursor(message: string): RequestValidationError {
  return RequestValidationError.fromIssues([{ path: ['cursor'], message }]);
}
