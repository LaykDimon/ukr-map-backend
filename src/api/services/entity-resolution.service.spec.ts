import { EntityResolutionService } from './entity-resolution.service';
import { Repository } from 'typeorm';
import { Person } from '../entities/person.entity';

describe('EntityResolutionService', () => {
  let service: EntityResolutionService;
  let mockRepo: Partial<Repository<Person>>;

  beforeEach(() => {
    mockRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      query: jest.fn().mockResolvedValue([]),
    };
    service = new EntityResolutionService(mockRepo as Repository<Person>);
  });

  describe('normalizeName', () => {
    it('should lowercase and trim', () => {
      expect(service.normalizeName('  Тарас Шевченко  ')).toBe(
        'тарас шевченко',
      );
    });

    it('should remove parenthetical suffixes', () => {
      expect(service.normalizeName('Іван Франко (письменник)')).toBe(
        'іван франко',
      );
    });

    it('should normalize apostrophes', () => {
      expect(service.normalizeName("Грінʼченко")).toBe("грін'ченко");
    });

    it('should collapse whitespace', () => {
      expect(service.normalizeName('Тарас   Григорович   Шевченко')).toBe(
        'тарас григорович шевченко',
      );
    });
  });

  describe('normalizeBirthPlace', () => {
    it('should remove parenthetical notes', () => {
      expect(
        service.normalizeBirthPlace('Моринці (нині Черкаська область)'),
      ).toBe('Моринці');
    });

    it('should remove historical state references', () => {
      expect(
        service.normalizeBirthPlace('Київ, Українська РСР, СРСР'),
      ).toBe('Київ');
    });

    it('should handle null/empty', () => {
      expect(service.normalizeBirthPlace('')).toBe('');
      expect(service.normalizeBirthPlace(null as any)).toBeFalsy();
    });
  });

  describe('mapCategoryLabel', () => {
    it('should map known Ukrainian categories to English labels', () => {
      expect(
        service.mapCategoryLabel('Категорія:Українські письменники'),
      ).toBe('writer');
      expect(service.mapCategoryLabel('Категорія:Політики України')).toBe(
        'politician',
      );
      expect(
        service.mapCategoryLabel('Категорія:Українські філософи'),
      ).toBe('philosopher');
    });

    it('should return original string for unknown categories', () => {
      expect(service.mapCategoryLabel('Unknown Category')).toBe(
        'Unknown Category',
      );
    });
  });

  describe('extractBirthYear', () => {
    it('should extract year from ISO date', () => {
      expect(service.extractBirthYear('1814-03-09')).toBe(1814);
    });

    it('should extract year from plain year', () => {
      expect(service.extractBirthYear('1722')).toBe(1722);
    });

    it('should extract year from Ukrainian date text', () => {
      expect(service.extractBirthYear('9 березня 1814 року')).toBe(1814);
    });

    it('should return null for null input', () => {
      expect(service.extractBirthYear(null)).toBeNull();
    });
  });

  describe('enrichOccupations', () => {
    it('should map Ukrainian occupations to English', () => {
      const result = service.enrichOccupations(['поет', 'письменник']);
      expect(result.occupations).toEqual(['writer']);
      expect(result.primaryCategory).toBe('writer');
    });

    it('should deduplicate mapped values', () => {
      const result = service.enrichOccupations([
        'поет',
        'письменник',
        'драматург',
      ]);
      expect(result.occupations).toEqual(['writer']);
    });

    it('should handle mixed known and unknown', () => {
      const result = service.enrichOccupations(['композитор', 'педагог']);
      expect(result.occupations).toContain('composer');
      expect(result.occupations).toContain('педагог');
    });

    it('should return empty for empty input', () => {
      const result = service.enrichOccupations([]);
      expect(result.occupations).toEqual([]);
      expect(result.primaryCategory).toBeNull();
    });
  });

  describe('findDuplicate', () => {
    it('should find by wikiPageId first', async () => {
      const person = { id: 'test-uuid-1', name: 'Test', wikiPageId: 123 } as Person;
      (mockRepo.findOne as jest.Mock).mockResolvedValueOnce(person);

      const result = await service.findDuplicate('Test Person', 123);
      expect(result).toBe(person);
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { wikiPageId: 123 },
      });
    });

    it('should fall back to exact name match', async () => {
      const person = { id: 'test-uuid-1', name: 'Test Person' } as Person;
      (mockRepo.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // wikiPageId miss
        .mockResolvedValueOnce(person); // name match

      const result = await service.findDuplicate('Test Person', 999);
      expect(result).toBe(person);
    });

    it('should return null when no match found', async () => {
      (mockRepo.findOne as jest.Mock).mockResolvedValue(null);
      (mockRepo.query as jest.Mock).mockResolvedValue([]);

      const result = await service.findDuplicate('Nobody');
      expect(result).toBeNull();
    });
  });
});
