import { describe, expect, it } from 'bun:test';
import { AllowAllProviderIdentityService } from './allow-all-provider-identity.service.js';

describe('AllowAllProviderIdentityService', () => {
  it('allows any provider on HTTP and SQS channels', () => {
    const service = new AllowAllProviderIdentityService();

    expect(() => {
      service.assertCanActAs('provider-a', 'http');
      service.assertCanActAs('another-provider', 'sqs');
    }).not.toThrow();
  });
});
