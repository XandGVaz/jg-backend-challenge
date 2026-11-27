import type { EntitySchema } from '@mikro-orm/core';
import { inboxEntities } from '../modules/inbox/persistence/index.js';
import { outboxEntities } from '../modules/outbox/persistence/index.js';
import { roundsEntities } from '../modules/rounds/persistence/index.js';
import { transactionsEntities } from '../modules/transactions/persistence/index.js';
import { walletsEntities } from '../modules/wallets/persistence/index.js';

/** Registro central dos mapeamentos (`modules/<modulo>/persistence/*.entity.ts`), lido pela app e pela CLI. */
export const entities: readonly EntitySchema[] = [
  ...transactionsEntities,
  ...walletsEntities,
  ...outboxEntities,
  ...inboxEntities,
  ...roundsEntities,
] as EntitySchema[];
