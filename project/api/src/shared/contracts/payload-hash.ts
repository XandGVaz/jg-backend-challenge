import { createHash } from 'node:crypto';

/** JSON sem espaços, com chaves por code point e sem propriedades undefined. */
export function canonicalJson(value: unknown): string {
  const serialized = serialize(value);

  if (serialized === undefined) {
    throw new TypeError('Payload must be JSON serializable');
  }

  return serialized;
}

export function computePayloadHash(payload: unknown): string {
  return `v1:${createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')}`;
}

function serialize(value: unknown): string | undefined {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item) ?? 'null').join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries: string[] = [];

    for (const key of Object.keys(record).sort(compareCodePoints)) {
      const item = serialize(record[key]);

      if (item === undefined) {
        continue;
      }

      entries.push(`${JSON.stringify(key)}:${item}`);
    }

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];

    if (difference !== 0) {
      return difference;
    }
  }

  return leftPoints.length - rightPoints.length;
}
