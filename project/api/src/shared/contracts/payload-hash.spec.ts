import { describe, expect, it } from 'bun:test';
import { canonicalJson, computePayloadHash } from './payload-hash.js';

describe('payloadHash', () => {
  it('sorts keys by code point at every level without adding whitespace', () => {
    const value = {
      z: 1,
      money: { currency: 'BRL', amount: '25.00' },
      a: [{ beta: true, alpha: false }],
      '10': 'ten',
      '2': 'two',
    };

    expect(canonicalJson(value)).toBe(
      '{"10":"ten","2":"two","a":[{"alpha":false,"beta":true}],"money":{"amount":"25.00","currency":"BRL"},"z":1}',
    );
  });

  it('compares non-BMP keys by code point rather than UTF-16 code unit', () => {
    expect(canonicalJson({ '\u{10000}': 1, '\ue000': 2 })).toBe('{"\ue000":2,"\u{10000}":1}');
  });

  it('removes undefined object keys recursively and preserves array positions', () => {
    const withUndefined = {
      providerId: 'provider-a',
      referenceExternalTransactionId: undefined,
      money: { amount: '25.00', currency: 'BRL', optional: undefined },
      values: [1, undefined, 3],
    };
    const withoutUndefined = {
      money: { currency: 'BRL', amount: '25.00' },
      values: [1, null, 3],
      providerId: 'provider-a',
    };

    expect(canonicalJson(withUndefined)).toBe(canonicalJson(withoutUndefined));
    expect(canonicalJson(withUndefined)).not.toContain('undefined');
  });

  it('returns lowercase sha256 with the v1 prefix', () => {
    expect(computePayloadHash({ amount: '25.00' })).toBe(
      'v1:9df5a242c2ae9f263e3caea8c4ce315df23fdbed3361a1933edbca62ce4755e4',
    );
    expect(computePayloadHash({ amount: '25.00' })).toMatch(/^v1:[0-9a-f]{64}$/);
  });

  it('produces the same hash for equivalent HTTP and SQS business payloads', () => {
    const httpPayload = {
      providerId: 'provider-a',
      externalTransactionId: 'external-123',
      playerId: '123e4567-e89b-42d3-a456-426614174000',
      walletId: '0192f2a0-0000-7000-8000-000000000000',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: undefined,
    };
    const sqsMessage = {
      messageId: 'message-456',
      occurredAt: '2026-07-29T15:00:00.000Z',
      type: 'SubmitTransaction',
      data: {
        kind: 'BET',
        gameId: 'game-1',
        roundId: 'round-1',
        walletId: '0192f2a0-0000-7000-8000-000000000000',
        playerId: '123e4567-e89b-42d3-a456-426614174000',
        externalTransactionId: 'external-123',
        providerId: 'provider-a',
        money: { currency: 'BRL', amount: '25.00' },
      },
    };

    expect(computePayloadHash(sqsMessage.data)).toBe(computePayloadHash(httpPayload));
  });

  it('changes the hash when a business field diverges', () => {
    const original = { providerId: 'provider-a', money: { amount: '25.00', currency: 'BRL' } };
    const divergent = { providerId: 'provider-a', money: { amount: '26.00', currency: 'BRL' } };

    expect(computePayloadHash(divergent)).not.toBe(computePayloadHash(original));
  });
});
