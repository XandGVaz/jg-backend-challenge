import { Logger } from '@nestjs/common';
import { AppError, ErrorKind, TransactionRejectedError } from '../../../shared/errors/index.js';
import {
  MessageOutcome,
  type HandlerResult,
  type ReceivedMessage,
} from '../../../shared/messaging/message-handler.js';
import { DuplicateTransactionError } from '../../transactions/domain/wager-transaction.errors.js';
import { WalletNotFoundError } from '../../wallets/domain/wallet.errors.js';
import {
  TransactionFailedError,
  type SubmitTransactionService,
} from '../services/submit-transaction.service.js';
import type { SubmitTransactionRequest } from '../wagering.schema.js';
import {
  WagerTransactionRequestedSchema,
  type WagerTransactionRequested,
} from './wager-transaction-requested.schema.js';

export const WAGER_TRANSACTIONS_CONSUMER = 'wager-transactions';

const ack: HandlerResult = { outcome: MessageOutcome.Ack };
const retry: HandlerResult = { outcome: MessageOutcome.Retry };
const invalid: HandlerResult = { outcome: MessageOutcome.DeadLetter, reason: 'invalid_message' };
const exhausted: HandlerResult = {
  outcome: MessageOutcome.DeadLetter,
  reason: 'retries_exhausted',
};

/**
 * Consumer de wager-transactions.fifo (api.md §12.1): valida, chama o mesmo caso de uso do HTTP com
 * a inbox e decide o destino. Resultado de negócio é ack; falha transitória volta com backoff, e na
 * entrega SQS_MAX_ATTEMPTS grava FAILED e vai para a DLQ (ESCOLHAS #19).
 */
export class WagerTransactionsHandler {
  private readonly logger = new Logger(WagerTransactionsHandler.name);

  constructor(
    private readonly submit: SubmitTransactionService,
    private readonly maxAttempts: number,
  ) {}

  async handle(message: ReceivedMessage): Promise<HandlerResult> {
    const parsed = parse(message.body);

    // Corpo inválido nunca é logado: pode carregar payload financeiro (loki.md §5).
    if (!parsed) {
      this.logger.error({ message: 'Invalid wager message', sqsMessageId: message.sqsMessageId });
      return invalid;
    }

    const { idempotencyKey, ...input } = parsed.data;

    try {
      await this.submit.submit(input as SubmitTransactionRequest, idempotencyKey, 'sqs', {
        consumerName: WAGER_TRANSACTIONS_CONSUMER,
        messageId: parsed.messageId,
      });
      return ack;
    } catch (error) {
      return this.settleFailure(
        error,
        message,
        parsed,
        input as SubmitTransactionRequest,
        idempotencyKey,
      );
    }
  }

  private async settleFailure(
    error: unknown,
    message: ReceivedMessage,
    parsed: WagerTransactionRequested,
    input: SubmitTransactionRequest,
    idempotencyKey: string,
  ): Promise<HandlerResult> {
    const context = {
      messageId: parsed.messageId,
      walletId: input.walletId,
      providerId: input.providerId,
    };

    if (error instanceof TransactionRejectedError || error instanceof TransactionFailedError) {
      this.logger.debug({ message: 'Wager message settled with a terminal result', ...context });
      return ack;
    }

    // Wallet inexistente e key reaproveitada são erros de negócio terminais: ack, sem DLQ (ESCOLHAS #16).
    if (error instanceof WalletNotFoundError || error instanceof DuplicateTransactionError) {
      this.logger.warn({ message: 'Wager message refused', code: error.code, ...context });
      return ack;
    }

    if (error instanceof AppError && error.kind === ErrorKind.Validation) {
      this.logger.error({
        message: 'Wager message failed validation',
        code: error.code,
        ...context,
      });
      return invalid;
    }

    if (message.receiveCount < this.maxAttempts) {
      this.logger.warn({
        message: 'Wager message will be retried',
        attempt: message.receiveCount,
        ...context,
      });
      return retry;
    }

    this.logger.error({
      message: 'Wager message exhausted its retries',
      attempt: message.receiveCount,
      ...context,
    });
    await this.submit.failExhausted(input, idempotencyKey);
    return exhausted;
  }
}

function parse(body: string): WagerTransactionRequested | undefined {
  try {
    const result = WagerTransactionRequestedSchema.safeParse(JSON.parse(body));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
