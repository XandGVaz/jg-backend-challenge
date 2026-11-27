import { E2E } from './env.js';

export interface HttpResult<T = Record<string, unknown>> {
  status: number;
  body: T;
}

export async function post<T = Record<string, unknown>>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResult<T>> {
  const response = await fetch(`${E2E.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

export async function get<T = Record<string, unknown>>(path: string): Promise<HttpResult<T>> {
  const response = await fetch(`${E2E.baseUrl}${path}`);
  return { status: response.status, body: (await response.json()) as T };
}
