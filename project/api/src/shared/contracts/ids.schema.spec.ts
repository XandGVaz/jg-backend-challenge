import { describe, expect, it } from 'bun:test';
import { newId } from '../domain/id.js';
import {
  EntryIdSchema,
  EventIdSchema,
  ExternalTransactionIdSchema,
  GameIdSchema,
  IdempotencyKeySchema,
  MessageIdSchema,
  PlayerIdSchema,
  ProviderIdSchema,
  RoundIdSchema,
  TransactionIdSchema,
  WalletIdSchema,
} from './ids.schema.js';

const UUID_V4 = '123e4567-e89b-42d3-a456-426614174000';

describe('id schemas', () => {
  it('requires UUIDv7 for every internal identifier', () => {
    const id = newId();

    for (const schema of [WalletIdSchema, TransactionIdSchema, EntryIdSchema, EventIdSchema]) {
      expect(schema.safeParse(id).success).toBe(true);
      expect(schema.safeParse(UUID_V4).success).toBe(false);
      expect(schema.safeParse('not-a-uuid').success).toBe(false);
    }
  });

  it('accepts a provider UUID for playerId', () => {
    expect(PlayerIdSchema.safeParse(UUID_V4).success).toBe(true);
    expect(PlayerIdSchema.safeParse('player-123').success).toBe(false);
  });

  it('validates providerId without uppercase letters or key separators', () => {
    expect(ProviderIdSchema.safeParse('provider-a').success).toBe(true);
    expect(ProviderIdSchema.safeParse('a'.repeat(64)).success).toBe(true);

    for (const providerId of ['', 'Provider', '-provider', 'provider:a', 'a'.repeat(65)]) {
      expect(ProviderIdSchema.safeParse(providerId).success).toBe(false);
    }
  });

  it('validates opaque external, round and game identifiers', () => {
    for (const schema of [ExternalTransactionIdSchema, RoundIdSchema, GameIdSchema]) {
      expect(schema.safeParse('Transaction_123.a-b').success).toBe(true);
      expect(schema.safeParse('a'.repeat(128)).success).toBe(true);

      for (const id of ['', 'has space', 'has/slash', 'a'.repeat(129)]) {
        expect(schema.safeParse(id).success).toBe(false);
      }
    }
  });

  it('validates the SQS messageId length', () => {
    expect(MessageIdSchema.safeParse('message-1').success).toBe(true);
    expect(MessageIdSchema.safeParse('a'.repeat(128)).success).toBe(true);
    expect(MessageIdSchema.safeParse('').success).toBe(false);
    expect(MessageIdSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('validates Idempotency-Key independently from the recommended composition', () => {
    expect(IdempotencyKeySchema.safeParse('provider-a:transaction-123').success).toBe(true);
    expect(IdempotencyKeySchema.safeParse('opaque_key.123').success).toBe(true);
    expect(IdempotencyKeySchema.safeParse('a'.repeat(255)).success).toBe(true);

    for (const key of ['', 'has space', 'has/slash', 'a'.repeat(256), undefined]) {
      expect(IdempotencyKeySchema.safeParse(key).success).toBe(false);
    }
  });
});
