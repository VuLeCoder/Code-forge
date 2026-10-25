import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const nested = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : body;
    const code = typeof nested.code === 'string' ? nested.code : status === 400 ? 'INVALID_REQUEST' :
      status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' :
        status === 409 ? 'CONFLICT' : status === 429 ? 'TOO_MANY_REQUESTS' : status === 503 ? 'DEPENDENCY_UNAVAILABLE' : 'REQUEST_FAILED';
    const rawMessage = nested.message ?? body.message;
    const message = typeof rawMessage === 'string' ? rawMessage : Array.isArray(rawMessage) ? rawMessage.join('; ') :
      status >= 500 ? 'Máy chủ chưa thể xử lý yêu cầu.' : 'Yêu cầu không hợp lệ.';
    const details = nested.details && typeof nested.details === 'object' ? nested.details : {};
    const requestId = randomUUID();
    response.setHeader('X-Request-ID', requestId);
    if (status >= 500 && !(exception instanceof HttpException)) {
      this.logger.error(JSON.stringify({ event: 'api_unhandled_error', requestId, method: request.method }));
    }
    response.status(status).json({ error: { code, message, details }, requestId });
  }
}
