import { Module } from '@nestjs/common';
import { SqsModule } from '../../shared/messaging/sqs.module.js';
import { HealthController } from './controllers/health.controller.js';
import { HealthService } from './services/health.service.js';

@Module({
  imports: [SqsModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
