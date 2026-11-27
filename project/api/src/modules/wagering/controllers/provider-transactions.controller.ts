import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../../shared/http/api-error-responses.decorator.js';
import { TransactionQueryService } from '../services/transaction-query.service.js';
import {
  ProviderTransactionParamsSchema,
  TransactionViewSchema,
  type ProviderTransactionParams,
  type TransactionView,
} from '../wagering.schema.js';

@ApiTags('wagering')
@Controller('providers/:providerId/wagering/transactions')
export class ProviderTransactionsController {
  constructor(private readonly queries: TransactionQueryService) {}

  @Get(':externalTransactionId')
  @ApiOperation({ summary: 'Consulta uma transação pelo id do provedor' })
  @ApiOkResponse({ standardSchema: TransactionViewSchema })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  get(
    @Param({ schema: ProviderTransactionParamsSchema }) params: ProviderTransactionParams,
  ): Promise<TransactionView> {
    return this.queries.getByExternal(params.providerId, params.externalTransactionId);
  }
}
