import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Person } from '../entities/person.entity';

@Injectable()
export class StatisticsService {
  constructor(
    @InjectRepository(Person)
    private personRepository: Repository<Person>,
  ) {}

  /**
   * Distribution of persons by decade.
   */
  async getTemporalDistribution(): Promise<
    { decade: number; count: number }[]
  > {
    const results = await this.personRepository.query(
      `SELECT (FLOOR("birthYear" / 10) * 10)::int AS decade, COUNT(*)::int AS count
       FROM person
       WHERE "birthYear" IS NOT NULL
       GROUP BY decade
       ORDER BY decade`,
    );
    return results;
  }

  /**
   * Distribution of persons by birth place (top N).
   */
  async getGeoDistribution(
    limit = 20,
  ): Promise<{ birthPlace: string; count: number }[]> {
    const results = await this.personRepository.query(
      `SELECT "birthPlace", COUNT(*)::int AS count
       FROM person
       WHERE "birthPlace" IS NOT NULL AND "birthPlace" != ''
       GROUP BY "birthPlace"
       ORDER BY count DESC
       LIMIT $1`,
      [limit],
    );
    return results.map((r: any) => ({
      birthPlace: r.birthPlace,
      count: r.count,
    }));
  }

  /**
   * Distribution of persons by category.
   */
  async getCategoryDistribution(): Promise<
    { category: string; count: number }[]
  > {
    const results = await this.personRepository.query(
      `SELECT category, COUNT(*)::int AS count
       FROM person
       WHERE category IS NOT NULL AND category != ''
       GROUP BY category
       ORDER BY count DESC`,
    );
    return results;
  }

  /**
   * Distribution of persons by death place (top N).
   * Uses the GIN index (idx_person_meta_data_gin) via the ? operator
   * for fast candidate selection before extracting the text value.
   */
  async getDeathPlaceDistribution(
    limit = 20,
  ): Promise<{ deathPlace: string; count: number }[]> {
    const results = await this.personRepository.query(
      `SELECT meta_data->>'deathPlace' AS "deathPlace", COUNT(*)::int AS count
       FROM person
       WHERE meta_data ? 'deathPlace'
         AND meta_data->>'deathPlace' != ''
       GROUP BY meta_data->>'deathPlace'
       ORDER BY count DESC
       LIMIT $1`,
      [limit],
    );
    return results.map((r: any) => ({
      deathPlace: r.deathPlace,
      count: r.count,
    }));
  }

  /**
   * Distribution of persons by occupation (top N).
   * Unnests the meta_data->'occupation' JSONB array;
   * the GIN index accelerates the ? operator for existence check.
   */
  async getOccupationDistribution(
    limit = 20,
  ): Promise<{ occupation: string; count: number }[]> {
    const results = await this.personRepository.query(
      `SELECT occ AS occupation, COUNT(*)::int AS count
       FROM person,
            jsonb_array_elements_text(meta_data->'occupation') AS occ
       WHERE meta_data ? 'occupation'
       GROUP BY occ
       ORDER BY count DESC
       LIMIT $1`,
      [limit],
    );
    return results.map((r: any) => ({
      occupation: r.occupation,
      count: r.count,
    }));
  }

  /**
   * Overview statistics.
   */
  async getOverview(): Promise<{
    totalPersons: number;
    totalWithCoordinates: number;
    totalCategories: number;
    minBirthYear: number;
    maxBirthYear: number;
    avgRating: number;
  }> {
    const result = await this.personRepository.query(
      `SELECT
         COUNT(*)::int AS "totalPersons",
         COUNT(CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 1 END)::int AS "totalWithCoordinates",
         COUNT(DISTINCT category)::int AS "totalCategories",
         MIN("birthYear")::int AS "minBirthYear",
         MAX("birthYear")::int AS "maxBirthYear",
         ROUND(AVG(rating)::numeric, 2)::float AS "avgRating"
       FROM person`,
    );
    return result[0];
  }
}
