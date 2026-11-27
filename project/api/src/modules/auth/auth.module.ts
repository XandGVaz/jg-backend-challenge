import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ProviderIdentityPort } from './domain/provider-identity.port.js';
import { AuthGuard } from './guards/auth.guard.js';
import { AllowAllProviderIdentityService } from './services/allow-all-provider-identity.service.js';

/** Pontos de extensão de autenticação HTTP e de identidade do provedor. */
@Global()
@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: ProviderIdentityPort,
      useClass: AllowAllProviderIdentityService,
    },
  ],
  exports: [ProviderIdentityPort],
})
export class AuthModule {}
