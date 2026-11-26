import { defineConfig, type Options } from '@mikro-orm/postgresql';
import { entities } from '../database/entities.js';
import type { Env } from './env.js';

/** Configuração do MikroORM só para acesso a dados; o schema é de project/database (Flyway). */
export function createMikroOrmConfig(env: Pick<Env, 'DATABASE_URL' | 'NODE_ENV'>): Options {
  return defineConfig({
    clientUrl: env.DATABASE_URL,
    entities: [...entities],
    discovery: { warnWhenNoEntities: false },
    forceUtcTimezone: true,
    debug: env.NODE_ENV === 'development',
  });
}
