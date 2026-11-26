import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { WageringModule } from './modules/wagering/wagering.module.js';
import { WalletsModule } from './modules/wallets/wallets.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { HttpModule } from './shared/http/http.module.js';

@Module({
  imports: [
    ObservabilityModule,
    HttpModule,
    DatabaseModule,
    HealthModule,
    WalletsModule,
    WageringModule,
  ],
})
export class AppModule {}
