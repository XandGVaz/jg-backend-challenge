import type { IncomingHttpHeaders } from 'node:http';
import { Body, Controller, Get, Headers, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponses } from '../../../shared/http/api-error-responses.decorator.js';
import { parseOrThrow } from '../../../shared/validation/parse-or-throw.js';
import { SubmitTransactionService } from '../services/submit-transaction.service.js';
import { TransactionQueryService } from '../services/transaction-query.service.js';
import { toSubmitResponse } from '../wagering.mapper.js';
import { SUBMIT_STATUS_BY_RESULT } from '../wagering.http.js';
import {
  SubmitTransactionHeadersSchema,
  SubmitTransactionRequestSchema,
  SubmitTransactionResponseSchema,
  TransactionIdParamsSchema,
  TransactionViewSchema,
  type SubmitTransactionRequest,
  type SubmitTransactionResponse,
  type TransactionIdParams,
  type TransactionView,
} from '../wagering.schema.js';

@ApiTags('wagering')
@Controller('wagering/transactions')
export class WageringTransactionsController {
  constructor(
    private readonly submitService: SubmitTransactionService,
    private readonly queries: TransactionQueryService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Submete uma operação de aposta (BET, WIN, LOSS, REFUND, ROLLBACK)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: '{providerId}:{externalTransactionId}',
  })
  @ApiCreatedResponse({ standardSchema: SubmitTransactionResponseSchema })
  @ApiAcceptedResponse({ standardSchema: SubmitTransactionResponseSchema })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.SERVICE_UNAVAILABLE,
  )
  async submit(
    @Body({ schema: SubmitTransactionRequestSchema }) body: SubmitTransactionRequest,
    @Headers() headers: IncomingHttpHeaders,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SubmitTransactionResponse> {
    const { 'idempotency-key': key } = parseOrThrow(SubmitTransactionHeadersSchema, headers);
    const result = await this.submitService.submit(body, key, 'http');
    response.status(SUBMIT_STATUS_BY_RESULT[result.transaction.status] ?? HttpStatus.OK);
    return toSubmitResponse(result.transaction, result.balance, result.idempotentReplay);
  }

  @Get(':transactionId')
  @ApiOperation({ summary: 'Consulta uma transação pelo id interno' })
  @ApiOkResponse({ standardSchema: TransactionViewSchema })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  get(
    @Param({ schema: TransactionIdParamsSchema }) params: TransactionIdParams,
  ): Promise<TransactionView> {
    return this.queries.getById(params.transactionId);
  }
}
