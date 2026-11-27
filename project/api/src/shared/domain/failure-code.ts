/**
 * Motivo do estado final de uma transação, gravado em `wager_transactions.failure_code` e repetido
 * no `code` do erro 422, no `TransactionView` e no evento `WagerTransactionRejected` (api.md §10).
 * Valor publicado nunca é renomeado nem reaproveitado com outro sentido.
 */
export enum FailureCode {
  /** `BET` maior que o saldo. */
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  /** `ROLLBACK` de crédito deixaria o saldo negativo. */
  ReversalInsufficientFunds = 'REVERSAL_INSUFFICIENT_FUNDS',
  /** Moeda da operação diferente da moeda da wallet. */
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  /** Wallet não pertence ao `playerId` da operação. */
  WalletPlayerMismatch = 'WALLET_PLAYER_MISMATCH',
  /** `PENDING_REFERENCE` esgotou as tentativas sem a referência chegar. */
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  /** Referência de outro provider, player, wallet, moeda ou rodada. */
  ReferenceMismatch = 'REFERENCE_MISMATCH',
  /** `REFUND` sem `BET`, ou `ROLLBACK` de `LOSS`/`ROLLBACK`/`OPENING`. */
  ReferenceKindNotAllowed = 'REFERENCE_KIND_NOT_ALLOWED',
  /** Referência existe, mas está `REJECTED` ou `FAILED`. */
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',
  /** Referência já estornada: uma `BET` aceita um único `REFUND` ou `ROLLBACK`. */
  ReferenceAlreadyReversed = 'REFERENCE_ALREADY_REVERSED',
  /** Valor da reversão diferente do valor da referência. */
  ReversalAmountMismatch = 'REVERSAL_AMOUNT_MISMATCH',
  /** `BET` que chega depois de um `REFUND` rejeitado que a citava. */
  BetAlreadyCancelled = 'BET_ALREADY_CANCELLED',
  /** `BET` numa rodada já fechada por `WIN` ou `LOSS`. */
  RoundClosed = 'ROUND_CLOSED',
  /** Erro transitório persistiu além do limite; a mensagem vai para a DLQ. */
  ProcessingRetriesExhausted = 'PROCESSING_RETRIES_EXHAUSTED',
}
