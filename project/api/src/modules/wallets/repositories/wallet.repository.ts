import { Injectable, Logger } from '@nestjs/common';
import {
  OptimisticLockError,
  UniqueConstraintViolationException,
  EntityManager,
} from '@mikro-orm/postgresql';
import { Wallet } from '../domain/wallet.js';
import { WalletAlreadyExistsError } from '../domain/wallet.errors.js';

/** Acesso a `wallets`; nunca faz flush nem abre transação. */
@Injectable()
export class WalletRepository {
  private readonly logger = new Logger(WalletRepository.name);

  constructor(private readonly em: EntityManager) {}

  /** INSERT imediato: a unicidade de (player_id, currency) é decidida aqui. */
  async add(wallet: Wallet): Promise<void> {
    try {
      await this.em.insert(wallet);
    } catch (error) {
      if (isConstraint(error, 'uq_wallets_player_currency')) {
        this.logger.warn({ message: 'Wallet already exists', playerId: wallet.playerId });
        throw new WalletAlreadyExistsError({ cause: error });
      }

      throw error;
    }
  }

  /** Lida fora do identity map: o saldo só é gravado por `save`, com a checagem de versão. */
  async findById(id: string): Promise<Wallet | undefined> {
    const found = await this.em.findOne(Wallet, { id }, { disableIdentityMap: true });
    return found ?? undefined;
  }

  /** Bloqueio otimista: grava só se ninguém mudou a wallet desde a leitura (REQUISITOS §8). */
  async save(wallet: Wallet, expectedVersion: number): Promise<void> {
    // SQL explícito: o nativeUpdate não traduz propriedades com accessor para o nome da coluna.
    const result = await this.em.execute<{ affectedRows: number }>(
      'UPDATE wallets SET balance_amount = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?',
      [wallet.balanceAmount, wallet.version, wallet.updatedAt, wallet.id, expectedVersion],
      'run',
    );
    const affected = result.affectedRows;

    if (affected === 0) {
      this.logger.debug({ message: 'Wallet version changed concurrently', walletId: wallet.id });
      throw OptimisticLockError.lockFailed('Wallet');
    }
  }
}

function isConstraint(error: unknown, name: string): boolean {
  return error instanceof UniqueConstraintViolationException && error.message.includes(name);
}
