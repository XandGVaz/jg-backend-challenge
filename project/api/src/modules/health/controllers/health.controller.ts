import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../../shared/http/api-error-responses.decorator.js';
import { Public } from '../../auth/public.decorator.js';
import {
  LivenessSchema,
  ReadinessSchema,
  type Liveness,
  type Readiness,
} from '../health.schema.js';
import { HealthService } from '../services/health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Processo vivo' })
  @ApiOkResponse({ standardSchema: LivenessSchema })
  live(): Liveness {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Dependências (PostgreSQL e SQS) alcançáveis' })
  @ApiOkResponse({ standardSchema: ReadinessSchema })
  @ApiErrorResponses(HttpStatus.SERVICE_UNAVAILABLE)
  ready(): Promise<Readiness> {
    return this.healthService.checkReadiness();
  }
}
