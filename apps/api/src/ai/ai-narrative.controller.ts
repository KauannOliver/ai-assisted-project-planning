import { Body, Controller, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { AiNarrativeService } from './ai-narrative.service';

class ImpactNarrativeDto {
  @IsOptional() @IsString() portfolioEndDateBefore?: string | null;
  @IsOptional() @IsString() portfolioEndDateAfter?: string | null;
  @IsOptional() @IsNumber() portfolioDifferenceDays?: number;
  @IsOptional() @IsNumber() affectedProjectsCount?: number;
  @IsOptional() @IsNumber() antecipadosCount?: number;
  @IsOptional() @IsNumber() postergadosCount?: number;
  @IsOptional() @IsNumber() novosAtrasos?: number;
  @IsOptional() @IsNumber() atrasosResolvidos?: number;
  @IsOptional() @IsString() portfolioEndUnchangedReason?: string | null;
  @IsOptional() @IsObject() criticalPathBefore?: Record<string, any> | null;
  @IsOptional() @IsObject() criticalPathAfter?: Record<string, any> | null;
  @IsOptional() @IsArray() topAffectedResources?: Array<Record<string, any>>;
  @IsOptional() @IsString() context?: string;
  @IsOptional() @IsArray() projects?: Array<{ projectName?: string; oldDate?: string; newDate?: string; diffDays?: number }>;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai')
export class AiNarrativeController {
  constructor(private readonly ai: AiNarrativeService) {}

  @Post('impact-analysis')
  async impactAnalysis(@Body() body: ImpactNarrativeDto) {
    const result = await this.ai.analyzeImpact(body);
    if (result.status === 'RATE_LIMITED') {
      throw new HttpException({
        code: 'AI_RATE_LIMITED',
        message: 'O limite temporário de análises por IA foi atingido. A análise local continua disponível.',
        details: result,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return result;
  }
}
