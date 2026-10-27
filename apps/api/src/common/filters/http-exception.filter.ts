import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private isDatabaseUnavailable(exception: any) {
    const unavailableCodes = new Set(['P1001', 'P1002', 'P1008', 'P1017']);
    if (unavailableCodes.has(exception?.code)) return true;

    const messages = [
      exception?.message,
      exception?.cause?.message,
      exception?.meta?.message,
    ].filter((value): value is string => typeof value === 'string');

    return messages.some((value) => /database system is (in recovery mode|starting up|shutting down)|can't reach database server|server has closed the connection unexpectedly|connection terminated unexpectedly|too many (connections|clients)|remaining connection slots are reserved/i.test(value));
  }

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = (request.headers['x-trace-id'] as string) ||
      Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Erro interno do servidor';
    let code = 'INTERNAL_SERVER_ERROR';
    let details: any = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resContent: any = exception.getResponse();
      if (typeof resContent === 'string') {
        message = resContent;
      } else {
        message = resContent.message || exception.message;
        code = resContent.code || `HTTP_${status}`;
        details = resContent.error || resContent;
      }
    } else if (exception && typeof exception === 'object') {
      const transportStatus = Number(exception.status || exception.statusCode);
      if (transportStatus === HttpStatus.PAYLOAD_TOO_LARGE || exception.type === 'entity.too.large') {
        status = HttpStatus.PAYLOAD_TOO_LARGE;
        code = 'IMPORT_FILE_TOO_LARGE';
        message = 'O arquivo possui dados demais para uma única validação. Envie um arquivo de até 10 MB.';
        details = {};
      } else if (transportStatus === HttpStatus.BAD_REQUEST && exception.type === 'entity.parse.failed') {
        status = HttpStatus.BAD_REQUEST;
        code = 'INVALID_REQUEST_CONTENT';
        message = 'O conteúdo enviado não está em um formato válido.';
        details = {};
      } else if (this.isDatabaseUnavailable(exception)) {
        status = HttpStatus.SERVICE_UNAVAILABLE;
        code = 'DATABASE_UNAVAILABLE';
        message = 'O banco de dados está temporariamente indisponível. Tente novamente em alguns instantes.';
        details = {};
        response.setHeader('Retry-After', '10');
      } else if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'DATABASE_CONFLICT';
        message = 'Conflito de registro no banco de dados (campo duplicado).';
        details = { fields: exception.meta?.target };
      } else if (exception.code === 'P2003') {
        status = HttpStatus.BAD_REQUEST;
        code = 'FOREIGN_KEY_CONSTRAINT_FAILED';
        message = 'Não é possível remover ou alterar este item pois ele está sendo referenciado por outros cadastros.';
        details = { meta: exception.meta };
      }
    }

    // Ensure error message is readable
    if (Array.isArray(message)) {
      details.validationErrors = message;
      message = message.join(', ');
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      console.error(`[${traceId}] ${request.method} ${request.originalUrl || request.url}`, exception?.stack || exception);
    }

    response.status(status).json({
      code,
      message,
      details,
      traceId,
    });
  }
}
