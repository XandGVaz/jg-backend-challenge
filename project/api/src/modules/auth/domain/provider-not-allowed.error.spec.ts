import { describe, expect, it } from 'bun:test';
import { AppError, ErrorKind } from '../../../shared/errors/app-error.js';
import { ProviderNotAllowedError } from './provider-not-allowed.error.js';

describe('ProviderNotAllowedError', () => {
  it('is a validation AppError with a stable code', () => {
    const error = new ProviderNotAllowedError();

    expect(error).toBeInstanceOf(AppError);
    expect(error.kind).toBe(ErrorKind.Validation);
    expect(error.code).toBe('PROVIDER_NOT_ALLOWED');
  });
});
