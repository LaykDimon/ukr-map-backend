import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Person } from '../entities/person.entity';

@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);

  constructor(
    @InjectRepository(Person)
    private personRepository: Repository<Person>,
  ) {}

  /**
   * Normalize a Ukrainian name for comparison:
   * - Lowercase
   * - Remove parenthetical suffixes like "(поет)"
   * - Normalize whitespace
   * - Trim
   */
  normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/[''ʼ`]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generate a slug for matching. Strips all non-letter/digit chars,
   * joins with hyphens, and lowercases.
   */
  toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  /**
   * Normalize a birth place string:
   * - Remove parenthetical historical names like "(нині Черкаська область)"
   * - Remove "Українська РСР", "СРСР" suffixes
   * - Normalize whitespace and commas
   */
  normalizeBirthPlace(place: string): string {
    if (!place) return place;

    return place
      .replace(/\(.*?\)/g, '')
      .replace(/,?\s*(Українська РСР|СРСР|УРСР|Російська імперія)/gi, '')
      .replace(/,\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Map a Ukrainian Wikipedia category name to a short English label.
   */
  mapCategoryLabel(ukCategory: string): string {
    const mapping: Record<string, string> = {
      'Категорія:Українські науковці': 'scientist',
      'Категорія:Українські письменники': 'writer',
      'Категорія:Політики України': 'politician',
      'Категорія:Українські художники': 'artist',
      'Категорія:Українські музиканти': 'musician',
      'Категорія:Українські актори': 'actor',
      'Категорія:Українські спортсмени': 'athlete',
      'Категорія:Українські підприємці': 'entrepreneur',
      'Категорія:Українські громадські діячі': 'activist',
      'Категорія:Українські філософи': 'philosopher',
      'Категорія:Українські історики': 'historian',
      'Категорія:Українські журналісти': 'journalist',
      'Категорія:Українські військовики': 'military',
      'Категорія:Українські дипломати': 'diplomat',
      'Категорія:Українські релігійні діячі': 'religious leader',
      'Категорія:Українські співаки': 'singer',
      'Категорія:Українські телеведучі': 'tv presenter',
    };
    return mapping[ukCategory] || ukCategory;
  }

  /**
   * Find a potential duplicate person by name similarity.
   * Uses pg_trgm similarity if available, otherwise exact normalized match.
   */
  async findDuplicate(
    name: string,
    wikiPageId?: number,
  ): Promise<Person | null> {
    // First: exact match by wikiPageId (most reliable)
    if (wikiPageId) {
      const byPageId = await this.personRepository.findOne({
        where: { wikiPageId },
      });
      if (byPageId) return byPageId;
    }

    // Second: exact name match
    const byName = await this.personRepository.findOne({
      where: { name },
    });
    if (byName) return byName;

    // Third: fuzzy match using pg_trgm % operator (GIN-index-accelerated)
    try {
      const normalized = this.normalizeName(name);
      await this.personRepository.query(
        `SET pg_trgm.similarity_threshold = 0.6`,
      );
      const results = await this.personRepository.query(
        `SELECT id, similarity(lower(name), $1) AS sim FROM person
         WHERE lower(name) % $1
         ORDER BY sim DESC
         LIMIT 1`,
        [normalized],
      );
      if (results.length > 0) {
        return this.personRepository.findOne({
          where: { id: results[0].id },
        });
      }
    } catch {
      // pg_trgm might not be available, fall back silently
    }

    return null;
  }

  /**
   * Extract birth year from a date string in various formats:
   * - "1814-03-09"
   * - "9 березня 1814"
   * - "1814"
   */
  extractBirthYear(dateStr: string | null): number | null {
    if (!dateStr) return null;

    // ISO format: "1814-03-09"
    const isoMatch = dateStr.match(/^(\d{4})-/);
    if (isoMatch) return parseInt(isoMatch[1]);

    // Four-digit year anywhere in string
    const yearMatch = dateStr.match(/\b(\d{4})\b/);
    if (yearMatch) return parseInt(yearMatch[1]);

    return null;
  }

  /**
   * Enrich occupation data from Wikidata SPARQL occupations.
   * Maps Wikidata occupation labels to standardized English categories.
   */
  enrichOccupations(occupationLabels: string[]): {
    occupations: string[];
    primaryCategory: string | null;
  } {
    if (!occupationLabels || occupationLabels.length === 0) {
      return { occupations: [], primaryCategory: null };
    }

    const categoryMap: Record<string, string> = {
      поет: 'writer',
      письменник: 'writer',
      письменниця: 'writer',
      драматург: 'writer',
      прозаїк: 'writer',
      науковець: 'scientist',
      вчений: 'scientist',
      фізик: 'scientist',
      хімік: 'scientist',
      біолог: 'scientist',
      математик: 'scientist',
      політик: 'politician',
      'державний діяч': 'politician',
      художник: 'artist',
      живописець: 'artist',
      скульптор: 'artist',
      музикант: 'musician',
      композитор: 'composer',
      співак: 'singer',
      співачка: 'singer',
      актор: 'actor',
      акторка: 'actor',
      режисер: 'director',
      спортсмен: 'athlete',
      філософ: 'philosopher',
      історик: 'historian',
      журналіст: 'journalist',
      військовик: 'military',
      дипломат: 'diplomat',
      підприємець: 'entrepreneur',
    };

    const mapped = occupationLabels
      .map((label) => {
        const lower = label.toLowerCase().trim();
        return categoryMap[lower] || lower;
      })
      .filter((v, i, arr) => arr.indexOf(v) === i); // deduplicate

    return {
      occupations: mapped,
      primaryCategory: mapped[0] || null,
    };
  }
}
