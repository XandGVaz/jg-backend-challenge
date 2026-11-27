import { HttpStatus } from '@nestjs/common';
import { WagerTransactionStatus } from '../transactions/domain/wager-transaction-status.js';

/** Status HTTP de sucesso do submit; REJECTED sai como 422 pelo ErrorHandler (api.md §11). */
export const SUBMIT_STATUS_BY_RESULT: Partial<Record<WagerTransactionStatus, HttpStatus>> = {
  [WagerTransactionStatus.Processed]: HttpStatus.CREATED,
  [WagerTransactionStatus.PendingReference]: HttpStatus.ACCEPTED,
};
