import { Module } from '@nestjs/common';
import { InboxRepository } from './repositories/inbox.repository.js';
import { InboxService } from './services/inbox.service.js';

/** Deduplicação persistente de mensagens na transação do caso de uso chamador. */
@Module({
  providers: [InboxRepository, InboxService],
  exports: [InboxService],
})
export class InboxModule {}
