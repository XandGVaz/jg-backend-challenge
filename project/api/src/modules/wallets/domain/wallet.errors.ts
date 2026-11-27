import { AppError, ErrorKind } from '../../../shared/errors/app-error.js';

/** Saldo insuficiente para o débito; quem chama decide o failureCode (aposta ou reversão, ESCOLHAS #12). */
export class InsufficientBalanceError extends AppError {
  readonly kind = ErrorKind.BusinessRule;
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor(
    readonly walletId: string,
    options?: ErrorOptions,
  ) {
    super(`Wallet ${walletId} has insufficient balance`, [], options);
  }
}

/** Wallet inexistente: 404 sem gravar nada, inclusive na submissão (ESCOLHAS #16). */
export class WalletNotFoundError extends AppError {
  readonly kind = ErrorKind.NotFound;
  readonly code = 'WALLET_NOT_FOUND';

  constructor(walletId: string, options?: ErrorOptions) {
    super(
      `Wallet ${walletId} not found`,
      [{ path: 'walletId', message: 'Wallet not found' }],
      options,
    );
  }
}

/** Já existe wallet para o mesmo playerId e moeda (uq_wallets_player_currency). */
export class WalletAlreadyExistsError extends AppError {
  readonly kind = ErrorKind.Conflict;
  readonly code = 'WALLET_ALREADY_EXISTS';

  constructor(options?: ErrorOptions) {
    super(
      'A wallet already exists for this player and currency',
      [{ path: 'initialBalance.currency', message: 'Wallet already exists for this currency' }],
      options,
    );
  }
}

/** Lançamento com aritmética inconsistente: erro de programação, nunca chega ao banco. */
export class UnbalancedLedgerEntryError extends AppError {
  readonly kind = ErrorKind.Internal;
  readonly code = 'UNBALANCED_LEDGER_ENTRY';

  constructor(entryId: string, reason: string, options?: ErrorOptions) {
    super(`Ledger entry ${entryId} is invalid: ${reason}`, [], options);
  }
}
