import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { InboxMessage } from '../domain/inbox-message.js';

@Injectable()
export class InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async insert(message: InboxMessage): Promise<boolean> {
    const result = await this.em
      .createQueryBuilder(InboxMessage)
      .insert(message)
      // A colisão da PK vira duplicata sem abortar a transação do chamador.
      .onConflict(['consumerName', 'messageId'])
      .ignore()
      .execute('run');

    return result.affectedRows > 0;
  }

  get(consumerName: string, messageId: string): Promise<InboxMessage> {
    return this.em.findOneOrFail(InboxMessage, { consumerName, messageId });
  }
}
