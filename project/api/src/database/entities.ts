import type { EntitySchema } from '@mikro-orm/core';

/** Registro central dos mapeamentos (`modules/<modulo>/persistence/*.entity.ts`), lido pela app e pela CLI. */
export const entities: readonly EntitySchema[] = [];
