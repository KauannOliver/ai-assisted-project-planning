import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.cookies?.['jwt_token'];

    if (!token) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Acesso negado. Token de sessão não encontrado.',
      });
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Token de autenticação inválido ou expirado.',
      });
    }
      
      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user || user.deletedAt) {
        throw new UnauthorizedException({
          code: 'USER_NOT_FOUND',
          message: 'Usuário não encontrado no sistema.',
        });
      }

      if (user.status === 'INACTIVE') {
        throw new UnauthorizedException({
          code: 'USER_INACTIVE',
          message: 'Usuário inativo. Acesso bloqueado.',
        });
      }

      if (user.tokenVersion !== payload.tokenVersion) {
        throw new UnauthorizedException({
          code: 'SESSION_EXPIRED',
          message: 'Sessão inválida ou expirada devido a alteração cadastral.',
        });
      }

      request.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        forcePasswordChange: user.forcePasswordChange,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      };

      const allowedDuringForcedChange = ['/auth/change-password', '/auth/logout', '/auth/me'];
      const requestPath = String(request.path || request.url || '').split('?')[0];
      if (user.forcePasswordChange && !allowedDuringForcedChange.includes(requestPath)) {
        throw new ForbiddenException({
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Altere sua senha provisória antes de continuar usando o sistema.',
        });
      }

      return true;
  }
}
