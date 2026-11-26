const BASE_SECONDS = 2;
const MAX_SECONDS = 300;

/** Backoff exponencial com jitter: 2, 4, 8… até 300 s, sorteado entre metade e o total. */
export function retryDelaySeconds(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(attempt, 1) - 1;
  const ceiling = Math.min(MAX_SECONDS, BASE_SECONDS * 2 ** exponent);
  return Math.ceil(ceiling / 2 + random() * (ceiling / 2));
}
