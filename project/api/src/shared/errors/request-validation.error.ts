import { AppError, ErrorKind, type ErrorDetail } from './app-error.js';

type IssuePathSegment = PropertyKey | { readonly key: PropertyKey };

/** Formato comum às issues do Standard Schema e do Zod (`safeParse().error.issues`). */
export interface ValidationIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<IssuePathSegment> | undefined;
}

/** Payload de entrada (HTTP ou fila) rejeitado pelo schema Zod. */
export class RequestValidationError extends AppError {
  readonly kind = ErrorKind.Validation;
  readonly code = 'REQUEST_VALIDATION_FAILED';

  static fromIssues(issues: readonly ValidationIssue[]): RequestValidationError {
    const details: ErrorDetail[] = issues.map((issue) => ({
      path: formatPath(issue.path),
      message: issue.message,
    }));
    return new RequestValidationError('Request payload is invalid', details);
  }
}

function formatPath(path: ValidationIssue['path']): string {
  if (!path || path.length === 0) {
    return '';
  }

  return path
    .map((segment) => (typeof segment === 'object' ? segment.key : segment))
    .map(String)
    .join('.');
}
