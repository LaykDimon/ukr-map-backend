import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Person } from '../entities/person.entity';

export interface SearchResult {
  person: Person;
  similarity?: number;
  levenshtein?: number;
  rank?: number;
}

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Person)
    private personRepository: Repository<Person>,
  ) {}

  /**
   * Fuzzy search using pg_trgm trigram similarity + Levenshtein distance.
   *
   * Uses the % operator in WHERE so PostgreSQL can leverage the GIN
   * trigram index (idx_person_name_trgm) for O(log N) candidate lookup.
   * Results are ranked by trigram similarity first; Levenshtein distance
   * is computed only for the top-N result set to avoid O(L²) cost on
   * every candidate row.
   *
   * Performance target: <20 ms on 100 000 records with GIN index.
   */
  async fuzzySearch(query: string, limit = 20): Promise<SearchResult[]> {
    // set_config inside the query avoids a separate network round-trip
    // for SET pg_trgm.similarity_threshold.
    // The CTE narrows candidates via the GIN-indexed % operator, then
    // levenshtein() runs only on the small LIMIT'd set.
    const results = await this.personRepository.query(
      `WITH _cfg AS (
         SELECT set_config('pg_trgm.similarity_threshold', '0.1', false)
       ),
       candidates AS (
         SELECT p.*, similarity(p.name, $1) AS sim
         FROM person p, _cfg
         WHERE p.name % $1
         ORDER BY sim DESC
         LIMIT $2
       )
       SELECT c.*,
              c.sim,
              levenshtein(lower(c.name), lower($1)) AS lev_dist
       FROM candidates c`,
      [query, limit],
    );

    return results.map((row: any) => ({
      person: this.mapRowToPerson(row),
      similarity: parseFloat(row.sim),
      levenshtein: parseInt(row.lev_dist, 10),
    }));
  }

  /**
   * Full-text search using PostgreSQL tsvector.
   * Searches across name and summary fields.
   * Uses the pre-built GIN index idx_person_fts.
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

  /**
   * Search persons by occupation using GIN-indexed JSONB containment (@>).
   * Leverages idx_person_meta_data_gin for O(log N) candidate lookup.
   */
  async searchByOccupation(occupation: string, limit = 50): Promise<Person[]> {
    const results = await this.personRepository.query(
      `SELECT p.*
       FROM person p
       WHERE p.meta_data->'occupation' @> $1::jsonb
       ORDER BY p.rating DESC
       LIMIT $2`,
      [JSON.stringify([occupation]), limit],
    );
    return results.map((row: any) => this.mapRowToPerson(row));
  }

  /**
   * Search persons by any meta_data attribute using GIN-indexed
   * JSONB containment (@>). Accepts a partial JSON object, e.g.
   * { "deathPlace": "Kyiv" } or { "deathYear": 1944 }.
   * Leverages idx_person_meta_data_gin for O(log N) candidate lookup.
   */
  async searchByMetadata(
    filter: Record<string, unknown>,
    limit = 50,
  ): Promise<Person[]> {
    const results = await this.personRepository.query(
      `SELECT p.*
       FROM person p
       WHERE p.meta_data @> $1::jsonb
       ORDER BY p.rating DESC
       LIMIT $2`,
      [JSON.stringify(filter), limit],
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
