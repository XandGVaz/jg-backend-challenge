/** Categoria do erro; o ErrorHandler traduz cada uma em um status HTTP. */
export enum ErrorKind {
  Validation = 'VALIDATION',
  NotFound = 'NOT_FOUND',
  Conflict = 'CONFLICT',
  BusinessRule = 'BUSINESS_RULE',
  Transient = 'TRANSIENT',
  Internal = 'INTERNAL',
}

export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * Base de todo erro esperado da aplicação.
 * Sem dependência de NestJS: domínio e casos de uso lançam subclasses desta classe.
 */
export abstract class AppError extends Error {
  abstract readonly kind: ErrorKind;
  /** Código estável e legível por máquina (ex.: `INSUFFICIENT_FUNDS`). */
  abstract readonly code: string;

  protected constructor(
    message: string,
    readonly details: readonly ErrorDetail[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}
