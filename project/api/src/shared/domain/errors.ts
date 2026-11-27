import { AppError, ErrorKind } from '../errors/app-error.js';

/** Valor monetário fora do formato decimal de escala dois ou com moeda inválida. */
export class InvalidMoneyError extends AppError {
  readonly kind = ErrorKind.Validation;
  readonly code = 'INVALID_MONEY';

  constructor(message = 'Invalid monetary value', path = 'money', options?: ErrorOptions) {
    super(message, [{ path, message }], options);
  }
}

/** Operação tentada entre valores de moedas diferentes. */
export class CurrencyMismatchError extends AppError {
  readonly kind = ErrorKind.BusinessRule;
  readonly code = 'CURRENCY_MISMATCH';

  constructor(expectedCurrency: string, receivedCurrency: string, options?: ErrorOptions) {
    super(
      `Expected currency ${expectedCurrency} but received ${receivedCurrency}`,
      [{ path: 'currency', message: `Expected ${expectedCurrency}` }],
      options,
    );
  }
}
