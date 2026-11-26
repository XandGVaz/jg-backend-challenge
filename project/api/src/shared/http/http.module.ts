import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { RequestValidationError } from '../errors/index.js';
import { ErrorHandler } from './error-handler.filter.js';

/** Validação Zod global e ErrorHandler global, registrados via DI. */
@Module({
  providers: [
    {
      provide: APP_PIPE,
      useValue: new StandardSchemaValidationPipe({
        exceptionFactory: (issues) => RequestValidationError.fromIssues(issues),
      }),
    },
    {
      provide: APP_FILTER,
      useClass: ErrorHandler,
    },
  ],
})
export class HttpModule {}
