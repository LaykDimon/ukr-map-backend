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
