import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Round } from '../domain/round.js';

@Injectable()
export class RoundRepository {
  private readonly logger = new Logger(RoundRepository.name);

  constructor(private readonly em: EntityManager) {}

  findForUpdate(providerId: string, roundId: string): Promise<Round | null> {
    return this.em.findOne(
      Round,
      { providerId, roundId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
  }

  async add(round: Round): Promise<Round> {
    // ON CONFLICT usa pk_rounds e espera a transação que venceu a primeira inserção.
    await this.em
      .createQueryBuilder(Round)
      .insert(round)
      .onConflict(['providerId', 'roundId'])
      .ignore()
      .execute();

    const persisted = await this.findForUpdate(round.providerId, round.roundId);

    if (persisted === null) {
      this.logger.error({
        message: 'Round missing after insert-or-get',
        providerId: round.providerId,
        roundId: round.roundId,
      });
      throw new Error('Round could not be read after insert-or-get');
    }

    return persisted;
  }
}
