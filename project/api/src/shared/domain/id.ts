import { randomBytes } from 'node:crypto';

const RANDOM_BITS_MASK = (1n << 74n) - 1n;
const RAND_B_MASK = (1n << 62n) - 1n;
let lastTimestamp = -1n;
let lastRandom = 0n;

/** UUIDv7 RFC 9562 com ordem monotônica dentro do processo. */
export function newId(): string {
  const timestamp = BigInt(Date.now());

  // O relógio lógico e o sufixo de 74 bits preservam a ordem no mesmo milissegundo.
  if (timestamp > lastTimestamp) {
    lastTimestamp = timestamp;
    lastRandom = randomSuffix();
  } else {
    lastRandom += 1n;

    if (lastRandom > RANDOM_BITS_MASK) {
      lastTimestamp += 1n;
      lastRandom = 0n;
    }
  }

  return formatUuidV7(lastTimestamp, lastRandom);
}

function randomSuffix(): bigint {
  return BigInt(`0x${randomBytes(10).toString('hex')}`) & RANDOM_BITS_MASK;
}

function formatUuidV7(timestamp: bigint, random: bigint): string {
  const timestampHex = timestamp.toString(16).padStart(12, '0');
  const randA = (random >> 62n).toString(16).padStart(3, '0');
  const variantAndRandB = ((2n << 62n) | (random & RAND_B_MASK)).toString(16).padStart(16, '0');
  const hex = `${timestampHex}7${randA}${variantAndRandB}`;

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20, 32)}`;
}
