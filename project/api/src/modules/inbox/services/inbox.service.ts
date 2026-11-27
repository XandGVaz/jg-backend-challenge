import { Injectable, Logger } from '@nestjs/common';
import { InboxMessage } from '../domain/inbox-message.js';
import { recordInboxDuplicate } from '../inbox.metrics.js';
import { InboxRepository } from '../repositories/inbox.repository.js';

export type InboxReceiveResult = 'new' | 'duplicate-processed' | 'duplicate-pending';

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(private readonly inbox: InboxRepository) {}

  async receive(
    consumerName: string,
    messageId: string,
    payloadHash: string,
  ): Promise<InboxReceiveResult> {
    const message = InboxMessage.receive({
      consumerName,
      messageId,
      payloadHash,
      receivedAt: new Date(),
    });
    const inserted = await this.inbox.insert(message);

    if (!inserted) {
      return this.classifyDuplicate(consumerName, messageId, payloadHash);
    }

    return 'new';
  }

  async markProcessed(consumerName: string, messageId: string, at: Date): Promise<void> {
    const message = await this.inbox.get(consumerName, messageId);
    message.markProcessed(at);
  }

  private async classifyDuplicate(
    consumerName: string,
    messageId: string,
    payloadHash: string,
  ): Promise<InboxReceiveResult> {
    const existing = await this.inbox.get(consumerName, messageId);
    const result: InboxReceiveResult = existing.isProcessed()
      ? 'duplicate-processed'
      : 'duplicate-pending';

    if (existing.payloadHash !== payloadHash) {
      this.logger.warn({
        message: 'Inbox duplicate payload hash mismatch',
        consumerName,
        messageId,
      });
      recordInboxDuplicate(consumerName);
      return result;
    }

    this.logger.debug({ message: 'Inbox duplicate received', consumerName, messageId });
    recordInboxDuplicate(consumerName);
    return result;
  }
}
