import { Injectable, Logger } from '@nestjs/common';
import { Round } from '../domain/round.js';
import { RoundClosedError } from '../domain/round-closed.error.js';
import { RoundRepository } from '../repositories/round.repository.js';

@Injectable()
export class RoundsService {
  private readonly logger = new Logger(RoundsService.name);

  constructor(private readonly rounds: RoundRepository) {}

  async assertBetAllowed(providerId: string, roundId: string, at: Date): Promise<void> {
    const round = await this.loadOrOpen(providerId, roundId, at);

    if (round.isClosed()) {
      this.logger.warn({ message: 'Bet refused because round is closed', providerId, roundId });
      throw new RoundClosedError(providerId, roundId);
    }
  }

  async registerResult(providerId: string, roundId: string, at: Date): Promise<void> {
    const round = await this.loadOrOpen(providerId, roundId, at);
    const closedByThisResult = round.close(at);

    if (!closedByThisResult) {
      this.logger.debug({
        message: 'Round result accepted on an already closed round',
        providerId,
        roundId,
      });
    }
  }

  private async loadOrOpen(providerId: string, roundId: string, at: Date): Promise<Round> {
    const round = await this.rounds.findForUpdate(providerId, roundId);

    if (round === null) {
      this.logger.debug({ message: 'Opening round on first touch', providerId, roundId });
      return this.rounds.add(Round.open(providerId, roundId, at));
    }

    return round;
  }
}
