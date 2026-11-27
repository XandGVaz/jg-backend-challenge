/** Tipo da operação; literais iguais ao CHECK `ck_wager_transactions_kind` (REQUISITOS §6.3). */
export enum WagerTransactionKind {
  /** Interno: crédito de abertura da wallet, nunca aceito em entrada. */
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}
