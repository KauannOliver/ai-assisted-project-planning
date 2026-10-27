import { describe, it, expect } from 'vitest';
import { ResourcesController } from '../../resources/resources.controller';

describe('TIC Business Rules Tests', () => {
  describe('Capacity Calculations (Module 04)', () => {
    it('should calculate resource capacity correctly according to the formula', () => {
      // Specifications Example:
      // Horas semanais: 44h
      // Overhead: 10%
      // Desenvolvimento: 70%
      // Expected math:
      // 44 * (1 - 0.10) = 39.6h after overhead
      // 39.6 * 0.70 = 27.72h weekly project capacity
      // 27.72 / 5 = 5.544h daily capacity
      
      const mockResource = {
        weeklyHours: 44,
        overheadPercentage: 0.10,
        developmentPercentage: 0.70,
      };

      const result = ResourcesController.calculateCapacity(mockResource);

      expect(result.hoursAfterOverhead).toBeCloseTo(39.6);
      expect(result.weeklyProjCapacity).toBeCloseTo(27.72);
      expect(result.dailyCapacity).toBeCloseTo(5.55);
    });

    it('should format capacity output into hours and minutes correctly', () => {
      // 27.72 hours = 27h and (0.72 * 60) = 43.2 minutes -> rounds to 43m
      const formattedWeekly = ResourcesController.formatHours(27.72);
      expect(formattedWeekly).toBe('27h 43m');

      // 5.544 hours = 5h and (0.544 * 60) = 32.64 minutes -> rounds to 33m
      const formattedDaily = ResourcesController.formatHours(5.544);
      expect(formattedDaily).toBe('5h 33m');
    });
  });
});
