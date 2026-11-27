import { Module } from '@nestjs/common';
import { RoundRepository } from './repositories/round.repository.js';
import { RoundsService } from './services/rounds.service.js';

/** Estado das rodadas consumido pelo processamento de transações. */
@Module({
  providers: [RoundRepository, RoundsService],
  exports: [RoundsService],
})
export class RoundsModule {}
