/** O que o poller faz com a mensagem depois que o handler termina. */
export enum MessageOutcome {
  Ack = 'ack',
  Retry = 'retry',
  DeadLetter = 'dlq',
}

export type DeadLetterReason = 'invalid_message' | 'retries_exhausted';

export type HandlerResult =
  | { outcome: MessageOutcome.Ack }
  | { outcome: MessageOutcome.Retry }
  | { outcome: MessageOutcome.DeadLetter; reason: DeadLetterReason };

export interface ReceivedMessage {
  /** Id gerado pelo SQS; não é o `messageId` do envelope, que é a chave da inbox. */
  sqsMessageId: string;
  body: string;
  groupId: string;
  /** `ApproximateReceiveCount`: 1 na primeira entrega. */
  receiveCount: number;
  /** `MessageAttributes` do tipo String (traceparent, tracestate, baggage). */
  attributes: Readonly<Record<string, string>>;
}

/** Contrato do consumer: valida, chama um service e diz o destino da mensagem. Lançar = retry. */
export type MessageHandler = (message: ReceivedMessage) => Promise<HandlerResult>;
