/** Estado da transação; literais iguais ao CHECK `ck_wager_transactions_status` (REQUISITOS §6.3). */
export enum WagerTransactionStatus {
  /** Aceita, ainda não aplicada; só existe dentro da transação SQL (ESCOLHAS #13). */
  Pending = 'PENDING',
  /** Aguardando a transação referenciada (REQUISITOS §7.1). */
  PendingReference = 'PENDING_REFERENCE',
  /** Aplicada (terminal). */
  Processed = 'PROCESSED',
  /** Violação de regra de negócio (terminal). */
  Rejected = 'REJECTED',
  /** Erro permanente de infraestrutura (terminal, auditável). */
  Failed = 'FAILED',
}

type TransitionTable = Readonly<Record<WagerTransactionStatus, readonly WagerTransactionStatus[]>>;

/** Transições válidas de ESCOLHAS #13; estados terminais não têm saída. */
export const WAGER_TRANSACTION_TRANSITIONS: TransitionTable = {
  [WagerTransactionStatus.Pending]: [
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
    WagerTransactionStatus.PendingReference,
  ],
  [WagerTransactionStatus.PendingReference]: [
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ],
  [WagerTransactionStatus.Processed]: [],
  [WagerTransactionStatus.Rejected]: [],
  [WagerTransactionStatus.Failed]: [],
};

export function canTransition(from: WagerTransactionStatus, to: WagerTransactionStatus): boolean {
  return WAGER_TRANSACTION_TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: WagerTransactionStatus): boolean {
  return WAGER_TRANSACTION_TRANSITIONS[status].length === 0;
}
