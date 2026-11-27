import { describe, expect, it } from 'bun:test';
import { FailureCode } from '../../../shared/domain/failure-code.js';
import { AppError, ErrorKind } from '../../../shared/errors/app-error.js';
import { RoundClosedError } from './round-closed.error.js';

describe('RoundClosedError', () => {
  it('is a business-rule AppError with the shared failure code', () => {
    const error = new RoundClosedError('provider-a', 'round-1');

    expect(error).toBeInstanceOf(AppError);
    expect(error.kind).toBe(ErrorKind.BusinessRule);
    expect(error.code).toBe(FailureCode.RoundClosed);
  });
});
