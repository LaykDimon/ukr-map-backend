import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Person } from '../entities/person.entity';

export interface SearchResult {
  person: Person;
  similarity?: number;
  rank?: number;
}

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Person)
    private personRepository: Repository<Person>,
  ) {}

  /**
   * Fuzzy search using pg_trgm trigram similarity.
   * Finds persons even with typos in the query.
   */
  async fuzzySearch(query: string, limit = 20): Promise<SearchResult[]> {
    const results = await this.personRepository.query(
      `SELECT p.*, similarity(p.name, $1) AS sim
       FROM person p
       WHERE similarity(p.name, $1) > 0.1
       ORDER BY sim DESC
       LIMIT $2`,
      [query, limit],
    );

    return results.map((row: any) => ({
      person: this.mapRowToPerson(row),
      similarity: parseFloat(row.sim),
    }));
  }

  /**
   * Full-text search using PostgreSQL tsvector.
   * Searches across name and summary fields.
   */
  async fullTextSearch(query: string, limit = 20): Promise<SearchResult[]> {
    const results = await this.personRepository.query(
      `SELECT p.*,
              ts_rank(
                to_tsvector('simple', coalesce(p.name, '') || ' ' || coalesce(p.summary, '')),
                plainto_tsquery('simple', $1)
              ) AS rank
       FROM person p
       WHERE to_tsvector('simple', coalesce(p.name, '') || ' ' || coalesce(p.summary, ''))
             @@ plainto_tsquery('simple', $1)
       ORDER BY rank DESC
       LIMIT $2`,
      [query, limit],
    );

    return results.map((row: any) => ({
      person: this.mapRowToPerson(row),
      rank: parseFloat(row.rank),
    }));
  }

  /**
   * Combined search: tries fuzzy first, falls back to full-text.
   */
  async search(
    query: string,
    type: 'fuzzy' | 'fulltext' | 'combined' = 'combined',
    limit = 20,
  ): Promise<SearchResult[]> {
    if (type === 'fuzzy') return this.fuzzySearch(query, limit);
    if (type === 'fulltext') return this.fullTextSearch(query, limit);

    // Combined: fuzzy on name + full-text on summary
    const fuzzyResults = await this.fuzzySearch(query, limit);
    if (fuzzyResults.length >= limit) return fuzzyResults;

    const fullTextResults = await this.fullTextSearch(query, limit);
    const fuzzyIds = new Set(fuzzyResults.map((r) => r.person.id));
    const combined = [
      ...fuzzyResults,
      ...fullTextResults.filter((r) => !fuzzyIds.has(r.person.id)),
    ];

    return combined.slice(0, limit);
  }

  /**
   * Geo-search: find persons within a radius (km) using PostGIS ST_DWithin.
   */
  async searchByRadius(
    lat: number,
    lng: number,
    radiusKm: number,
    limit = 100,
  ): Promise<Person[]> {
    const radiusMeters = radiusKm * 1000;
    const results = await this.personRepository.query(
      `SELECT p.*
       FROM person p
       WHERE p."birthLocation" IS NOT NULL
         AND ST_DWithin(
           p."birthLocation"::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3
         )
       ORDER BY ST_Distance(
         p."birthLocation"::geography,
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
       )
       LIMIT $4`,
      [lng, lat, radiusMeters, limit],
    );

    return results.map((row: any) => this.mapRowToPerson(row));
  }

  /**
   * Geo-search: find persons within a GeoJSON polygon using PostGIS ST_Within.
   */
  async searchByPolygon(
    polygonGeoJson: object,
    limit = 100,
  ): Promise<Person[]> {
    const results = await this.personRepository.query(
      `SELECT p.*
       FROM person p
       WHERE p."birthLocation" IS NOT NULL
         AND ST_Within(
           p."birthLocation",
           ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)
         )
       ORDER BY p.rating DESC
       LIMIT $2`,
      [JSON.stringify(polygonGeoJson), limit],
    );

    return results.map((row: any) => this.mapRowToPerson(row));
  }

  private mapRowToPerson(row: any): Person {
    const person = new Person();
    person.id = row.id;
    person.name = row.name;
    person.slug = row.slug;
    person.wikiPageId = row.wikiPageId ?? row.wikipageid;
    person.summary = row.summary;
    person.birthYear = row.birthYear ?? row.birthyear;
    person.birthDate = row.birthDate ?? row.birthdate;
    person.birthPlace = row.birthPlace ?? row.birthplace;
    person.lat = row.lat;
    person.lng = row.lng;
    person.meta_data = row.meta_data;
    person.views = row.views;
    person.rating = row.rating;
    person.imageUrl = row.imageUrl ?? row.imageurl;
    person.category = row.category;
    person.isManual = row.isManual ?? row.ismanual;
    person.createdAt = row.createdAt ?? row.createdat;
    person.updatedAt = row.updatedAt ?? row.updatedat;
    return person;
  }
}
