import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import { defineConfig, type Options } from '@mikro-orm/postgresql';
import { entities } from '../database/entities.js';
import type { Env } from './env.js';

type DatabaseEnv = Pick<
  Env,
  | 'DATABASE_URL'
  | 'NODE_ENV'
  | 'DATABASE_SSL_MODE'
  | 'DATABASE_SSL_CA_FILE'
  | 'DATABASE_POOL_MIN'
  | 'DATABASE_POOL_MAX'
>;

/** Configuração do MikroORM só para acesso a dados; o schema é de project/database (Flyway). */
export function createMikroOrmConfig(env: DatabaseEnv): Options {
  const ssl = createSslOptions(env);

  return defineConfig({
    clientUrl: env.DATABASE_URL,
    entities: [...entities],
    discovery: { warnWhenNoEntities: false },
    forceUtcTimezone: true,
    debug: env.NODE_ENV === 'development',
    // Soma de api e workers precisa caber no max_connections do RDS (ou no limite do RDS Proxy).
    pool: { min: env.DATABASE_POOL_MIN, max: env.DATABASE_POOL_MAX },
    ...(ssl && { driverOptions: { ssl } }),
  });
}

/** Opções TLS do pg: require cifra sem validar o certificado; verify-full valida cadeia e host. */
export function createSslOptions(
  env: Pick<Env, 'DATABASE_SSL_MODE' | 'DATABASE_SSL_CA_FILE'>,
): ConnectionOptions | undefined {
  if (env.DATABASE_SSL_MODE === 'disable') {
    return undefined;
  }

  if (env.DATABASE_SSL_MODE === 'require') {
    return { rejectUnauthorized: false };
  }

  // Sem arquivo, valida pelas raízes públicas (caso do RDS Proxy, com certificado da Amazon Trust Services).
  if (!env.DATABASE_SSL_CA_FILE) {
    return { rejectUnauthorized: true };
  }

  return { rejectUnauthorized: true, ca: readFileSync(env.DATABASE_SSL_CA_FILE, 'utf8') };
}
