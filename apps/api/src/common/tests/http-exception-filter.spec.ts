import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '../filters/http-exception.filter';

function contextFor(exceptionMessage: string) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const setHeader = vi.fn();
  const response = { status, setHeader };
  const request = { headers: {}, method: 'POST', originalUrl: '/auth/login' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return {
    exception: { message: exceptionMessage },
    host,
    json,
    status,
    setHeader,
  };
}

describe('HttpExceptionFilter', () => {
  it('does not expose query internals or classify every query error as temporary downtime', () => {
    const test = contextFor('Error querying the database: syntax error near secret_query');
    new HttpExceptionFilter().catch(test.exception, test.host);
    expect(test.status).toHaveBeenCalledWith(500);
    expect(test.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Erro interno do servidor' }));
    expect(test.setHeader).not.toHaveBeenCalled();
  });
  it('returns a retryable 503 while PostgreSQL is recovering', () => {
    const test = contextFor('Error querying the database: FATAL: the database system is in recovery mode');

    new HttpExceptionFilter().catch(test.exception, test.host);

    expect(test.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(test.setHeader).toHaveBeenCalledWith('Retry-After', '10');
    expect(test.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'DATABASE_UNAVAILABLE',
      message: 'O banco de dados está temporariamente indisponível. Tente novamente em alguns instantes.',
      details: {},
    }));
  });
});
