import { Injectable, Logger } from '@nestjs/common';
import { ProviderIdentityPort } from '../domain/provider-identity.port.js';

/** Implementação temporária que aceita qualquer provedor até a checagem de posse ser habilitada. */
@Injectable()
export class AllowAllProviderIdentityService extends ProviderIdentityPort {
  private readonly logger = new Logger(AllowAllProviderIdentityService.name);

  assertCanActAs(providerId: string, channel: 'http' | 'sqs'): void {
    this.logger.debug({
      message: 'Provider identity accepted without ownership check',
      providerId,
      channel,
    });
  }
}
