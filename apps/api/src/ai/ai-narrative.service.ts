import { Injectable } from '@nestjs/common';
import Groq from 'groq-sdk';
import {
  containsForbiddenPresentationTerm,
  sanitizeNaturalLanguage,
} from '../imports-exports/import-export.utils';

export interface ImpactNarrativeInput {
  portfolioEndDateBefore?: string | null;
  portfolioEndDateAfter?: string | null;
  portfolioDifferenceDays?: number;
  affectedProjectsCount?: number;
  antecipadosCount?: number;
  postergadosCount?: number;
  novosAtrasos?: number;
  atrasosResolvidos?: number;
  portfolioEndUnchangedReason?: string | null;
  criticalPathBefore?: Record<string, any> | null;
  criticalPathAfter?: Record<string, any> | null;
  topAffectedResources?: Array<Record<string, any>>;
  context?: string;
  projects?: Array<{ projectName?: string; oldDate?: string; newDate?: string; diffDays?: number }>;
}

export type ImpactNarrativeResult = {
  status: 'AI_GENERATED' | 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'UNAVAILABLE';
  analysis: string;
  model?: string;
  upstreamStatus?: number;
  retryAfterSeconds?: number;
};

@Injectable()
export class AiNarrativeService {
  private cooldownUntil = 0;

  private localAnalysis(input: ImpactNarrativeInput): string {
    const difference = Number(input.portfolioDifferenceDays || 0);
    const affected = Number(input.affectedProjectsCount || 0);
    const postponed = Number(input.postergadosCount || 0);
    const anticipated = Number(input.antecipadosCount || 0);
    const newDelays = Number(input.novosAtrasos || 0);
    const resolvedDelays = Number(input.atrasosResolvidos || 0);
    const movement = difference > 0
      ? `A previsão final do portfólio foi postergada em ${difference} dia${difference === 1 ? '' : 's'}.`
      : difference < 0
        ? `A previsão final do portfólio foi antecipada em ${Math.abs(difference)} dia${Math.abs(difference) === 1 ? '' : 's'}.`
        : input.portfolioEndUnchangedReason || 'A data final prevista do portfólio permanece inalterada.';
    const balance = `${affected} projeto${affected === 1 ? '' : 's'} serão afetados: ${postponed} postergado${postponed === 1 ? '' : 's'} e ${anticipated} antecipado${anticipated === 1 ? '' : 's'}.`;
    const risk = newDelays > 0
      ? `Atenção: ${newDelays} novo${newDelays === 1 ? '' : 's'} atraso${newDelays === 1 ? '' : 's'} será criado.`
      : resolvedDelays > 0
        ? `${resolvedDelays} atraso${resolvedDelays === 1 ? '' : 's'} será resolvido com a alteração.`
        : 'A alteração não cria novos atrasos na simulação.';
    return `${movement} ${balance} ${risk}`;
  }

  private retryAfterSeconds(error: any): number {
    const raw = error?.headers?.get?.('retry-after') ?? error?.headers?.['retry-after'];
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 60;
  }

  async analyzeImpact(input: ImpactNarrativeInput): Promise<ImpactNarrativeResult> {
    const fallback = this.localAnalysis(input);
    const apiKey = process.env.GROQ_API_KEY?.trim();
    const model = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-20b';

    if (!apiKey) return { status: 'NOT_CONFIGURED', analysis: fallback, model };

    if (Date.now() < this.cooldownUntil) {
      return {
        status: 'RATE_LIMITED',
        analysis: fallback,
        model,
        upstreamStatus: 429,
        retryAfterSeconds: Math.max(1, Math.ceil((this.cooldownUntil - Date.now()) / 1000)),
      };
    }

    const client = new Groq({
      apiKey,
      maxRetries: 0,
      timeout: Math.max(2000, Number(process.env.GROQ_TIMEOUT_MS || 7000)),
    });

    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.25,
        top_p: 0.9,
        max_completion_tokens: 260,
        reasoning_effort: 'low',
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'Você é um analista de portfólio de projetos. Responda em português do Brasil, em um único parágrafo curto, objetivo e executivo. Não invente números nem datas. Destaque o principal risco ou benefício e sugira somente uma ação prática. Nunca use enums, códigos internos, palavras em caixa alta ou termos técnicos em inglês como DELAYED, ON_TIME, AT_RISK, NEW_FORECAST, REMOVED_FROM_SCHEDULE, SIMULTANEOUS ou SEQUENTIAL.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              contexto: input.context || 'Alteração no cenário de alocação e capacidade',
              fimAntes: input.portfolioEndDateBefore || null,
              fimDepois: input.portfolioEndDateAfter || null,
              diferencaDias: input.portfolioDifferenceDays || 0,
              projetosAfetados: input.affectedProjectsCount || 0,
              antecipados: input.antecipadosCount || 0,
              postergados: input.postergadosCount || 0,
              novosAtrasos: input.novosAtrasos || 0,
              atrasosResolvidos: input.atrasosResolvidos || 0,
              motivoDataFinalInalterada: input.portfolioEndUnchangedReason || null,
              caminhoCriticoAnterior: input.criticalPathBefore || null,
              caminhoCriticoProposto: input.criticalPathAfter || null,
              recursosMaisAfetados: (input.topAffectedResources || []).slice(0, 5),
              principaisProjetos: (input.projects || []).slice(0, 8).map((project: any) => ({
                projeto: project.projectName || project.title || project.sdNumber || 'Projeto',
                dataAnterior: project.oldDate || null,
                novaData: project.newDate || null,
                variacaoEmDias: Number(project.diffDays ?? project.daysShifted ?? 0),
                impacto: project.changeType === 'NEW_FORECAST'
                  ? 'Passou a ter previsão'
                  : project.changeType === 'REMOVED_FROM_SCHEDULE'
                    ? 'Saiu da simulação'
                    : Number(project.diffDays ?? project.daysShifted ?? 0) > 0
                      ? 'Previsão postergada'
                      : Number(project.diffDays ?? project.daysShifted ?? 0) < 0
                        ? 'Previsão antecipada'
                        : 'Sem alteração na data',
              })),
            }),
          },
        ],
      } as any);
      const rawAnalysis = completion.choices[0]?.message?.content?.trim();
      const analysis = sanitizeNaturalLanguage(rawAnalysis || fallback);
      return {
        status: 'AI_GENERATED',
        analysis: containsForbiddenPresentationTerm(analysis) ? fallback : analysis,
        model,
      };
    } catch (error: any) {
      const status = Number(error?.status || error?.statusCode || 0);
      if (status === 429) {
        const retryAfterSeconds = this.retryAfterSeconds(error);
        this.cooldownUntil = Date.now() + retryAfterSeconds * 1000;
        return { status: 'RATE_LIMITED', analysis: fallback, model, upstreamStatus: 429, retryAfterSeconds };
      }
      console.warn(`Groq impact analysis unavailable (status ${status || 'unknown'}); using local analysis.`);
      return { status: 'UNAVAILABLE', analysis: fallback, model, upstreamStatus: status || undefined };
    }
  }
}
