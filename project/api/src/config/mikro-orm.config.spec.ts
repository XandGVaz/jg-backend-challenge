import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMikroOrmConfig, createSslOptions } from './mikro-orm.config.js';

describe('createSslOptions', () => {
  it('disables TLS by default', () => {
    expect(createSslOptions({ DATABASE_SSL_MODE: 'disable' })).toBeUndefined();
  });

  it('encrypts without verifying the certificate in require mode', () => {
    expect(createSslOptions({ DATABASE_SSL_MODE: 'require' })).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('verifies against the public roots when no CA file is given', () => {
    expect(createSslOptions({ DATABASE_SSL_MODE: 'verify-full' })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('verifies against the CA bundle file when one is given', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ca-')), 'bundle.pem');
    writeFileSync(file, 'PEM');
    expect(
      createSslOptions({ DATABASE_SSL_MODE: 'verify-full', DATABASE_SSL_CA_FILE: file }),
    ).toEqual({ rejectUnauthorized: true, ca: 'PEM' });
  });
});

describe('createMikroOrmConfig', () => {
  const env = {
    DATABASE_URL: 'postgres://u:p@db:5432/app',
    NODE_ENV: 'production',
    DATABASE_SSL_MODE: 'disable',
    DATABASE_POOL_MIN: 0,
    DATABASE_POOL_MAX: 10,
    DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: 30000,
  } as const;

  it('hydrates NULL as undefined, the shape the domain expects', () => {
    expect(createMikroOrmConfig(env).forceUndefined).toBe(true);
  });

  it('passes the idle-in-transaction timeout to the pg driver options', () => {
    expect(createMikroOrmConfig(env).driverOptions).toEqual({
      idle_in_transaction_session_timeout: 30000,
    });
  });

  it('keeps the ssl options alongside the timeout when tls is enabled', () => {
    const config = createMikroOrmConfig({ ...env, DATABASE_SSL_MODE: 'require' });

    expect(config.driverOptions).toEqual({
      ssl: { rejectUnauthorized: false },
      idle_in_transaction_session_timeout: 30000,
    });
  });

  it('omits the timeout when it is disabled', () => {
    const config = createMikroOrmConfig({ ...env, DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: 0 });

    expect(config.driverOptions).toBeUndefined();
  });

  it('keeps only the ssl options when the timeout is disabled', () => {
    const config = createMikroOrmConfig({
      ...env,
      DATABASE_SSL_MODE: 'require',
      DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: 0,
    });

    expect(config.driverOptions).toEqual({ ssl: { rejectUnauthorized: false } });
  });
});
