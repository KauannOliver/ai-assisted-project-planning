import { 
  Controller, 
  Post, 
  Body, 
  Req, 
  Res, 
  Get, 
  Patch,
  UseGuards, 
  BadRequestException, 
  UnauthorizedException, 
  HttpStatus 
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response, Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

class LoginDto {
  @IsEmail({}, { message: 'E-mail inválido.' })
  @IsNotEmpty({ message: 'E-mail é obrigatório.' })
  email: string;

  @IsNotEmpty({ message: 'Senha é obrigatória.' })
  password: string;
}

class ChangePasswordDto {
  @IsNotEmpty({ message: 'Senha atual é obrigatória.' })
  currentPassword: string;

  @MinLength(6, { message: 'A nova senha deve ter no mínimo 6 caracteres.' })
  @IsNotEmpty({ message: 'Nova senha é obrigatória.' })
  newPassword: string;
}

class AdminResetPasswordDto {
  @IsNotEmpty({ message: 'ID do usuário é obrigatório.' })
  userId: string;

  @MinLength(6, { message: 'A nova senha deve ter no mínimo 6 caracteres.' })
  @IsNotEmpty({ message: 'Nova senha é obrigatória.' })
  newPassword: string;
}

class UpdateProfileDto {
  @IsNotEmpty({ message: 'Nome é obrigatório.' })
  name: string;

  @IsEmail({}, { message: 'E-mail inválido.' })
  email: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  private expiresAt(token: string) {
    const payload = this.jwtService.decode(token) as { exp?: number } | null;
    return payload?.exp ? new Date(payload.exp * 1000).toISOString() : null;
  }

  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException({
        code: 'BAD_CREDENTIALS',
        message: 'E-mail ou senha incorretos.',
      });
    }

    if (user.status === 'INACTIVE') {
      throw new UnauthorizedException({
        code: 'USER_INACTIVE',
        message: 'Esta conta de usuário está desativada.',
      });
    }

    // Check temp lock
    if (user.tempLockedUntil && user.tempLockedUntil > new Date()) {
      const remainingSeconds = Math.ceil(
        (user.tempLockedUntil.getTime() - Date.now()) / 1000,
      );
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: `Conta temporariamente bloqueada. Tente novamente em ${minutes}m ${seconds}s.`,
      });
    }

    const passwordMatches = bcrypt.compareSync(body.password, user.passwordHash);

    if (!passwordMatches) {
      const nextAttempts = user.invalidAttempts + 1;
      let tempLockedUntil: Date | null = null;
      let message = 'E-mail ou senha incorretos.';

      if (nextAttempts >= 5) {
        tempLockedUntil = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes lock
        message = 'Conta bloqueada por 10 minutos após 5 tentativas incorretas.';
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          invalidAttempts: nextAttempts,
          tempLockedUntil,
        },
      });

      throw new UnauthorizedException({
        code: nextAttempts >= 5 ? 'ACCOUNT_LOCKED' : 'BAD_CREDENTIALS',
        message,
      });
    }

    // Reset invalid attempts and set last login
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        invalidAttempts: 0,
        tempLockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // Generate JWT
    const token = this.jwtService.sign({
      userId: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      tokenVersion: updatedUser.tokenVersion,
    });

    // Set cookie
    response.cookie('jwt_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    return {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      forcePasswordChange: updatedUser.forcePasswordChange,
      expiresAt: this.expiresAt(token),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Req() request: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const userId = request.user.id;

    // Increment token version to invalidate all current tokens/cookies
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        tokenVersion: { increment: 1 },
      },
    });

    response.clearCookie('jwt_token');
    return { message: 'Logout realizado com sucesso.' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @Req() request: any,
    @Body() body: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const userId = request.user.id;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new BadRequestException({
        code: 'USER_NOT_FOUND',
        message: 'Usuário não encontrado.',
      });
    }

    const currentMatches = bcrypt.compareSync(body.currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new BadRequestException({
        code: 'INCORRECT_CURRENT_PASSWORD',
        message: 'A senha atual informada está incorreta.',
      });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(body.newPassword, salt);

    // Invalidate sessions and update password
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        forcePasswordChange: false,
        tokenVersion: { increment: 1 },
        invalidAttempts: 0,
        tempLockedUntil: null,
      },
    });

    // Re-issue JWT for the updated token version
    const token = this.jwtService.sign({
      userId: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      tokenVersion: updatedUser.tokenVersion,
    });

    response.cookie('jwt_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    return {
      message: 'Senha atualizada com sucesso.',
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      forcePasswordChange: updatedUser.forcePasswordChange,
      expiresAt: this.expiresAt(token),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() request: any) {
    return request.user;
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(@Req() request: any, @Body() body: UpdateProfileDto) {
    const email = body.email.trim().toLowerCase();
    const duplicate = await this.prisma.user.findFirst({ where: { email, id: { not: request.user.id } } });
    if (duplicate) throw new BadRequestException({ code: 'EMAIL_ALREADY_USED', message: 'Este e-mail já está vinculado a outro usuário.' });
    const before = await this.prisma.user.findUnique({ where: { id: request.user.id } });
    const updated = await this.prisma.$transaction(async tx => {
      const user = await tx.user.update({
        where: { id: request.user.id },
        data: { name: body.name.trim(), email },
        select: { id: true, name: true, email: true, role: true, forcePasswordChange: true, tokenVersion: true },
      });
      await tx.businessEvent.create({ data: {
        aggregateType: 'USER', aggregateId: user.id, eventType: 'PROFILE_UPDATED',
        description: 'Informações do perfil atualizadas.', userId: user.id, actorName: user.name,
        metadata: { before: { name: before?.name, email: before?.email }, after: { name: user.name, email: user.email } },
      } });
      return user;
    });
    return { id: updated.id, name: updated.name, email: updated.email, role: updated.role, forcePasswordChange: updated.forcePasswordChange };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin-reset-password')
  async adminResetPassword(@Body() body: AdminResetPasswordDto) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: body.userId },
    });

    if (!targetUser || targetUser.deletedAt) {
      throw new BadRequestException({
        code: 'USER_NOT_FOUND',
        message: 'Usuário de destino não encontrado.',
      });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(body.newPassword, salt);

    await this.prisma.user.update({
      where: { id: body.userId },
      data: {
        passwordHash,
        forcePasswordChange: true, // Force reset on their first login
        tokenVersion: { increment: 1 }, // Invalidates active cookies on other devices
        invalidAttempts: 0,
        tempLockedUntil: null,
      },
    });

    return { message: `Senha do usuário ${targetUser.name} redefinida e alteração obrigatória configurada.` };
  }
}
