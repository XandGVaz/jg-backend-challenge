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

  it('defaults the pending-reference policy, the idle timeout and the events queue', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://u:p@db:5432/app' });

    expect(env.PENDING_REFERENCE_MAX_ATTEMPTS).toBe(10);
    expect(env.PENDING_REFERENCE_BACKOFF_BASE_SECONDS).toBe(2);
    expect(env.PENDING_REFERENCE_BACKOFF_MAX_SECONDS).toBe(300);
    expect(env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(30000);
    expect(env.SQS_WALLET_EVENTS_QUEUE).toBe('wallet-events.fifo');
  });

  it('fails when the pending-reference backoff base exceeds the max', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://u:p@db:5432/app',
        PENDING_REFERENCE_BACKOFF_BASE_SECONDS: '400',
      }),
    ).toThrow(/PENDING_REFERENCE_BACKOFF_BASE_SECONDS/);
  });

  it('fails when the wallet events queue name does not end with .fifo', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://u:p@db:5432/app',
        SQS_WALLET_EVENTS_QUEUE: 'wallet-events',
      }),
    ).toThrow(/\.fifo/);
  });
});
