import { afterEach, describe, expect, it } from 'vitest';
import { AiNarrativeService } from '../../ai/ai-narrative.service';

const originalKey = process.env.GROQ_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalKey;
});

describe('optional AI impact narrative', () => {
  it('returns a useful local analysis when no Groq key is configured', async () => {
    delete process.env.GROQ_API_KEY;
    const result = await new AiNarrativeService().analyzeImpact({
      portfolioDifferenceDays: 4,
      affectedProjectsCount: 3,
      postergadosCount: 2,
      antecipadosCount: 1,
      novosAtrasos: 1,
    });

    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.analysis).toContain('postergada em 4 dias');
    expect(result.analysis).toContain('novo atraso');
  });

  it('preserves the fallback and reports 429 during the rate-limit cooldown', async () => {
    process.env.GROQ_API_KEY = 'test-only-key';
    const service = new AiNarrativeService();
    (service as any).cooldownUntil = Date.now() + 30_000;
    const result = await service.analyzeImpact({ portfolioDifferenceDays: -2, affectedProjectsCount: 1 });

    expect(result.status).toBe('RATE_LIMITED');
    expect(result.upstreamStatus).toBe(429);
    expect(result.analysis).toContain('antecipada em 2 dias');
  });
});
