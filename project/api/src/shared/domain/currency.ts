export const ACCEPTED_CURRENCIES = ['BRL'] as const;

/** Moedas habilitadas na fronteira da aplicação, sem limitar o modelo multi-moeda. */
export function isAcceptedCurrency(code: string): boolean {
  return ACCEPTED_CURRENCIES.some((currency) => currency === code);
}
