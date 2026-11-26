import { describe, expect, it } from 'bun:test';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('keeps DATABASE_URL when it is set', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://u:p@db:5432/app' });
    expect(env.DATABASE_URL).toBe('postgres://u:p@db:5432/app');
  });

  it('builds DATABASE_URL from the parts injected by Secrets Manager', () => {
    const env = loadEnv({
      DB_HOST: 'proxy.rds.amazonaws.com',
      DB_NAME: 'wagering',
      DB_USER: 'app',
      DB_PASSWORD: 'p@ss/w:rd',
    });
    expect(env.DATABASE_URL).toBe(
      'postgres://app:p%40ss%2Fw%3Ard@proxy.rds.amazonaws.com:5432/wagering',
    );
    expect(new URL(env.DATABASE_URL).password).toBe('p%40ss%2Fw%3Ard');
  });

  it('fails when neither DATABASE_URL nor every part is set', () => {
    expect(() => loadEnv({ DB_HOST: 'db', DB_NAME: 'wagering' })).toThrow(/DB_USER/);
  });

  it('fails when the pool minimum exceeds the maximum', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://u:p@db/app',
        DATABASE_POOL_MIN: '5',
        DATABASE_POOL_MAX: '2',
      }),
    ).toThrow(/DATABASE_POOL_MIN/);
  });
});
