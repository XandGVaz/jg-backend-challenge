import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../../shared/http/api-error-responses.decorator.js';
import { OpenWalletService } from '../services/open-wallet.service.js';
import { ReconciliationService } from '../services/reconciliation.service.js';
import { WalletQueryService } from '../services/wallet-query.service.js';
import {
  CreateWalletRequestSchema,
  LedgerPageQuerySchema,
  LedgerPageSchema,
  ReconciliationReportSchema,
  WalletIdParamsSchema,
  WalletViewSchema,
  type CreateWalletRequest,
  type LedgerPage,
  type LedgerPageQuery,
  type ReconciliationReport,
  type WalletIdParams,
  type WalletView,
} from '../wallets.schema.js';

@ApiTags('wallets')
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly openWallet: OpenWalletService,
    private readonly queries: WalletQueryService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Cria a wallet do jogador com o saldo inicial' })
  @ApiCreatedResponse({ standardSchema: WalletViewSchema })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT, HttpStatus.SERVICE_UNAVAILABLE)
  create(
    @Body({ schema: CreateWalletRequestSchema }) body: CreateWalletRequest,
  ): Promise<WalletView> {
    return this.openWallet.open(body);
  }

  @Get(':walletId')
  @ApiOperation({ summary: 'Consulta a wallet e o saldo atual' })
  @ApiOkResponse({ standardSchema: WalletViewSchema })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  get(@Param({ schema: WalletIdParamsSchema }) params: WalletIdParams): Promise<WalletView> {
    return this.queries.get(params.walletId);
  }

  @Get(':walletId/ledger')
  @ApiOperation({ summary: 'Lançamentos do ledger, paginados por cursor' })
  @ApiOkResponse({ standardSchema: LedgerPageSchema })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  ledger(
    @Param({ schema: WalletIdParamsSchema }) params: WalletIdParams,
    @Query({ schema: LedgerPageQuerySchema }) query: LedgerPageQuery,
  ): Promise<LedgerPage> {
    return this.queries.ledgerPage(params.walletId, query);
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compara o saldo materializado com o saldo reconstruído pelo ledger' })
  @ApiOkResponse({ standardSchema: ReconciliationReportSchema })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  reconcile(
    @Param({ schema: WalletIdParamsSchema }) params: WalletIdParams,
  ): Promise<ReconciliationReport> {
    return this.reconciliation.reconcile(params.walletId);
  }
}
