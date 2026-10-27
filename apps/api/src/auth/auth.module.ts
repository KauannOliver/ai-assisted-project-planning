import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [ConfigModule, JwtModule.registerAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const secret = config.get<string>('JWT_SECRET');
      if (!secret || secret.length < 32) throw new Error('JWT_SECRET deve possuir pelo menos 32 caracteres.');
      return { secret, signOptions: { expiresIn: '24h' } };
    },
  })],
  controllers: [AuthController],
  providers: [JwtAuthGuard, RolesGuard],
  exports: [JwtModule, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
