import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

@Injectable()
export class BiApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configuredKey = String(this.config.get<string>('BI_API_KEY') ?? '').trim();
    if (!configuredKey) {
      throw new ServiceUnavailableException({
        code: 'BI_API_NOT_CONFIGURED',
        message: 'A integração de BI ainda não foi configurada neste ambiente.',
      });
    }

    const request = context.switchToHttp().getRequest();
    const providedHeader = request.headers?.['x-api-key'];
    const providedKey = Array.isArray(providedHeader) ? providedHeader[0] : providedHeader;
    if (typeof providedKey !== 'string' || !providedKey.trim()) {
      throw new UnauthorizedException({
        code: 'BI_API_KEY_REQUIRED',
        message: 'Informe a chave de integração no cabeçalho X-API-Key.',
      });
    }

    const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
    if (!timingSafeEqual(digest(configuredKey), digest(providedKey.trim()))) {
      throw new UnauthorizedException({
        code: 'INVALID_BI_API_KEY',
        message: 'A chave de integração informada é inválida.',
      });
    }
    return true;
  }
}
