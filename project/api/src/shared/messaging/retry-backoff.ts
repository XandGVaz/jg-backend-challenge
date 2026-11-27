export const DEFAULT_BACKOFF_BASE_SECONDS = 2;
export const DEFAULT_BACKOFF_MAX_SECONDS = 300;

/** Backoff exponencial com jitter: dobra até o teto, sorteado entre metade e o total. */
export function retryDelaySeconds(
  attempt: number,
  random: () => number = Math.random,
  options: { baseSeconds?: number; maxSeconds?: number } = {},
): number {
  const exponent = Math.max(attempt, 1) - 1;
  const base = options.baseSeconds ?? DEFAULT_BACKOFF_BASE_SECONDS;
  const max = options.maxSeconds ?? DEFAULT_BACKOFF_MAX_SECONDS;
  const ceiling = Math.min(max, base * 2 ** exponent);
  return Math.ceil(ceiling / 2 + random() * (ceiling / 2));
}
