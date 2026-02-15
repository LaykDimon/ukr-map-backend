import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Person } from '../entities/person.entity';
import { ImportLog, ImportStatus } from '../entities/import-log.entity';
import { EntityResolutionService } from './entity-resolution.service';
import { JSDOM } from 'jsdom';

interface RawMember {
  pageid: number;
  title: string;
  views: number;
}

interface DetailedMember extends RawMember {
  birthDate: string | null;
  birthPlace: string | null;
  summary?: string;
  imageUrl?: string;
  occupation?: string[];
  deathPlace?: string;
  deathDate?: string;
}

export interface WikiPerson extends DetailedMember {
  lat: number | null;
  lng: number | null;
  rating: number;
  category: string;
}

@Injectable()
export class WikipediaService {
  private readonly logger = new Logger(WikipediaService.name);
  private readonly WIKIPEDIA_API_URL = 'https://uk.wikipedia.org/w/api.php';
  private readonly REQUEST_DELAY = 500;
  private readonly FETCH_TIMEOUT = 15000;

  /**
   * Prefixes to search for people-related categories on Ukrainian Wikipedia.
   * Each prefix is queried via the allcategories API to discover all matching categories.
   */
  private readonly CATEGORY_PREFIXES = [
    'Українські ',
    'Діячі ',
  ];

  /**
   * Keywords that indicate a category contains people (used for filtering).
   */
  private readonly PEOPLE_KEYWORDS = [
    'письменник', 'поет', 'художник', 'композитор', 'науковц', 'вчен',
    'політик', 'дипломат', 'військов', 'спортсмен', 'актор', 'актрис',
    'режисер', 'співак', 'співач', 'музикант', 'філософ', 'історик',
    'журналіст', 'лікар', 'архітектор', 'скульптор', 'педагог',
    'священик', 'священник', 'винахідник', 'математик', 'фізик',
    'хімік', 'біолог', 'економіст', 'правник', 'юрист', 'діяч',
    'меценат', 'космонавт', 'льотчик', 'генерал', 'адмірал',
    'гетьман', 'кобзар', 'бандурист', 'драматург', 'перекладач',
    'мовознавц', 'археолог', 'етнограф', 'географ', 'астроном',
    'інженер', 'програміст', 'підприєм', 'бізнесмен', 'фотограф',
    'дизайнер', 'модельєр', 'танцівник', 'танцюрист', 'хореограф',
    'балетмейстер', 'письменниц', 'поетес', 'піаніст', 'скрипал',
    'лінгвіст', 'ботанік', 'зоолог', 'геолог', 'психолог',
    'соціолог', 'культуролог', 'мистецтвознав', 'літературознав',
    'кінорежисер', 'телеведуч', 'радіоведуч', 'продюсер',
    'сценарист', 'аніматор', 'ілюстратор', 'каліграф',
    'олімпійц', 'футболіст', 'боксер', 'борц', 'легкоатлет',
    'плавц', 'гімнаст', 'шахіст', 'тенісист', 'волейболіст',
    'баскетболіст', 'біатлоніст', 'велосипедист', 'фехтувальник',
    'стрілець', 'веслувальник', 'ковзаняр', 'лижник',
    'партизан', 'розвідник', 'полковник', 'отаман',
    'релігійн', 'богослов', 'місіонер', 'проповідник',
    'селекціонер', 'агроном', 'ветеринар', 'фармацевт',
  ];

  /**
   * Keywords that indicate a category is NOT about people.
   */
  private readonly EXCLUDE_KEYWORDS = [
    'організац', 'товариств', 'компані', 'корабл', 'населен',
    'село ', 'міст ', 'район', 'област', 'вулиц', 'станці',
    'річк', 'озер', 'гір ', 'фільм', 'альбом', 'книг',
    'пісн', 'роман', 'серіал', 'відеоігр', 'монумент',
    'пам\'ятник', 'бібліотек', 'музе', 'стадіон', 'аеропорт',
  ];

  /**
   * For prefixes that aren't inherently Ukrainian (e.g. "Діячі"),
   * the category must also contain one of these markers to be included.
   */
  private readonly UKRAINIAN_MARKERS = ['українськ', 'україни'];

  /**
   * Extra well-known categories that don't match prefix patterns but contain Ukrainian people.
   */
  private readonly EXTRA_CATEGORIES = [
    'Категорія:Політики України',
    'Категорія:Гетьмани України',
    'Категорія:Козацькі отамани',
    'Категорія:Народні артисти України',
    'Категорія:Герої України',
    'Категорія:Лауреати Шевченківської премії',
  ];
  private readonly IGNORED_KEYWORDS = [
    'Івлєєва',
    'Медведчук',
    'Арестович',
    'Марченко',
  ];

  constructor(
    @InjectRepository(Person)
    private personRepository: Repository<Person>,
    @InjectRepository(ImportLog)
    private importLogRepository: Repository<ImportLog>,
    private readonly entityResolution: EntityResolutionService,
  ) {}

  /**
   * Dynamically discover all people-related categories from Ukrainian Wikipedia.
   * Queries the allcategories API for each prefix, filters by people keywords,
   * and combines with extra known categories.
   */
  async discoverCategories(): Promise<string[]> {
    const discovered = new Set<string>();

    for (const prefix of this.CATEGORY_PREFIXES) {
      let accontinue: string | undefined;

      do {
        const params = new URLSearchParams({
          action: 'query',
          list: 'allcategories',
          acprefix: prefix,
          aclimit: '500',
          format: 'json',
        });
        if (accontinue) {
          params.set('accontinue', accontinue);
        }

        try {
          const data = await this.fetchFromWiki(params);
          const categories: { '*': string }[] = data?.query?.allcategories || [];

          for (const cat of categories) {
            const name = cat['*'];
            const lower = name.toLowerCase();

            const isPeopleRelated = this.PEOPLE_KEYWORDS.some((kw) => lower.includes(kw));
            const isExcluded = this.EXCLUDE_KEYWORDS.some((kw) => lower.includes(kw));

            // "Українські " prefix is inherently Ukrainian; other prefixes
            // (e.g. "Діячі ") require an explicit Ukrainian marker in the name.
            const isUkrainian = prefix === 'Українські ' ||
              this.UKRAINIAN_MARKERS.some((m) => lower.includes(m));

            if (isPeopleRelated && !isExcluded && isUkrainian) {
              discovered.add(`Категорія:${name}`);
            }
          }

          accontinue = data?.continue?.accontinue;
          await this.sleep(this.REQUEST_DELAY);
        } catch (error) {
          this.logger.error(`Error discovering categories with prefix "${prefix}": ${error.message}`);
          break;
        }
      } while (accontinue);
    }

    // Add extra well-known categories
    for (const cat of this.EXTRA_CATEGORIES) {
      discovered.add(cat);
    }

    this.logger.log(`Discovered ${discovered.size} people-related categories`);
    return Array.from(discovered);
  }

  async getAllPeople(): Promise<Person[]> {
    return this.personRepository.find({
      order: { rating: 'DESC' },
    });
  }

  async startSync(forceRefresh = false) {
    this.logger.log(`Manual sync started... (forceRefresh: ${forceRefresh})`);
    this.runFullSyncPipeline(forceRefresh).catch((err) => this.logger.error(err));
    return { status: 'Sync started in background' };
  }

  /**
   * Sync a single category with optional limit for testing/debugging.
   */
  async syncSingleCategory(categoryName: string, limit = 10) {
    // Accept any category that starts with "Категорія:"
    if (!categoryName.startsWith('Категорія:')) {
      categoryName = `Категорія:${categoryName}`;
    }

    this.logger.log(
      `Single category sync: "${categoryName}" (limit: ${limit})`,
    );

    try {
      const people = await this.processCategory(categoryName, limit);
      const results = { saved: 0, skipped: 0, errors: [] as string[] };

      for (const p of people) {
        try {
          await this.saveOrUpdatePerson(p);
          results.saved++;
        } catch (e: any) {
          results.errors.push(`${p.title}: ${e.message}`);
        }
      }

      await this.recalculateAllRatings();

      const log = await this.importLogRepository.save({
        sourceUrl: `uk.wikipedia.org/wiki/${encodeURIComponent(categoryName)}`,
        status: ImportStatus.SUCCESS,
        message: `Test sync: ${results.saved} saved, ${results.errors.length} errors`,
        recordsProcessed: results.saved,
      });

      return {
        status: 'completed',
        totalProcessed: people.length,
        saved: results.saved,
        errors: results.errors,
        people: people.map((p) => ({
          title: p.title,
          pageid: p.pageid,
          views: p.views,
          birthDate: p.birthDate,
          birthPlace: p.birthPlace,
          lat: p.lat,
          lng: p.lng,
          rating: p.rating,
          category: p.category,
          occupation: p.occupation,
        })),
        logId: log.id,
      };
    } catch (e: any) {
      this.logger.error(`Single category sync failed: ${e.message}`);
      return { status: 'error', message: e.message };
    }
  }

  /**
   * Remove all non-manual persons from the database for a clean re-import.
   */
  async clearImportedPersons() {
    const result = await this.personRepository
      .createQueryBuilder()
      .delete()
      .where('isManual = :isManual', { isManual: false })
      .execute();

    this.logger.log(
      `Cleared ${result.affected} imported persons from database`,
    );
    return { deleted: result.affected };
  }

  async getAvailableCategories() {
    return this.discoverCategories();
  }

  @Cron(CronExpression.EVERY_WEEK)
  async handleCron() {
    this.logger.log('Cron job started: Updating database...');
    await this.runFullSyncPipeline();
  }

  private async runFullSyncPipeline(forceRefresh = false) {
    // Pre-warm geocode cache from all existing persons in DB
    this.geocodeCache.clear();
    const allPersonsWithCoords = await this.personRepository.find({
      select: ['birthPlace', 'lat', 'lng'],
      where: { lat: Not(IsNull()), lng: Not(IsNull()) },
    });
    for (const p of allPersonsWithCoords) {
      if (p.birthPlace) {
        const key = p.birthPlace.toLowerCase().trim();
        if (!this.geocodeCache.has(key)) {
          this.geocodeCache.set(key, { lat: p.lat, lng: p.lng });
        }
      }
    }
    this.logger.log(`Geocode cache pre-warmed with ${this.geocodeCache.size} unique places from DB`);

    const categories = await this.discoverCategories();
    this.logger.log(`Starting full sync with ${categories.length} categories`);

    for (const category of categories) {
      try {
        const people = await this.processCategory(category, undefined, forceRefresh);
        for (const p of people) await this.saveOrUpdatePerson(p);

        await this.importLogRepository.save({
          sourceUrl: `uk.wikipedia.org/wiki/${encodeURIComponent(category)}`,
          status: ImportStatus.SUCCESS,
          message: `Processed ${people.length} people`,
          recordsProcessed: people.length,
        });

        await this.sleep(2000);
      } catch (e: any) {
        this.logger.error(
          `Failed to process category ${category}: ${e.message}`,
        );

        await this.importLogRepository.save({
          sourceUrl: `uk.wikipedia.org/wiki/${encodeURIComponent(category)}`,
          status: ImportStatus.FAILED,
          message: e.message,
          recordsProcessed: 0,
        });
      }
    }

    await this.recalculateAllRatings();
    this.logger.log('Full sync completed!');
  }

  async processCategory(
    categoryName: string,
    limit?: number,
    forceRefresh = false,
  ): Promise<WikiPerson[]> {
    this.logger.log(`Processing category: ${categoryName}${limit ? ` (limit: ${limit})` : ' (all members)'}`);

    const rawMembers = await this.fetchCategoryMembers(categoryName);
    const filteredMembers = rawMembers.filter((m) => !this.isIgnored(m.title));
    this.logger.log(
      `Found ${filteredMembers.length} pages after title filtering (from ${rawMembers.length} raw).`,
    );

    // Batch-load all existing persons from DB to avoid N individual queries
    const existingMap = await this.batchLoadExisting(
      filteredMembers.map((m) => m.pageid),
    );

    // When not forcing refresh, skip members that are fully cached in DB
    let membersToProcess: { pageid: number; title: string }[];
    if (!forceRefresh) {
      membersToProcess = filteredMembers.filter((m) => {
        const existing = existingMap.get(m.pageid);
        if (!existing) return true; // new person, needs processing
        // Skip if fully cached: has coords, summary, image, and meta_data
        const hasMetaData = existing.meta_data && Object.keys(existing.meta_data).length > 0;
        const isComplete = existing.lat && existing.summary && existing.imageUrl && hasMetaData && existing.views > 0;
        return !isComplete;
      });
      const skipped = filteredMembers.length - membersToProcess.length;
      if (skipped > 0) {
        this.logger.log(`Skipping ${skipped} fully-cached persons, processing ${membersToProcess.length} new/incomplete`);
      }
    } else {
      membersToProcess = filteredMembers;
    }

    if (membersToProcess.length === 0) {
      this.logger.log(`All ${filteredMembers.length} persons already cached — nothing to do`);
      return [];
    }

    let topMembers: RawMember[];
    if (limit) {
      const subset = membersToProcess.slice(0, limit * 3);
      const withViews = await this.enrichWithViews(subset, forceRefresh, existingMap);
      topMembers = withViews.slice(0, limit);
    } else {
      topMembers = await this.enrichWithViews(membersToProcess, forceRefresh, existingMap);
    }

    // Validate that entries are actually humans via Wikidata P31=Q5
    const validatedMembers = await this.filterHumansOnly(topMembers, existingMap);
    this.logger.log(
      `${validatedMembers.length}/${topMembers.length} confirmed as humans via Wikidata.`,
    );

    const detailedMembers = await this.enrichWithDetails(validatedMembers, existingMap);

    const geocodedMembers = await this.enrichWithCoordinates(detailedMembers, existingMap);
    return geocodedMembers.map((person) => ({
      ...person,
      category: categoryName,
      rating: this.calculateRating(person.views),
    }));
  }

  /**
   * Batch-load all existing persons by wikiPageId in a single query
   * to avoid N individual findOne queries in each enrichment step.
   */
  private async batchLoadExisting(
    pageIds: number[],
  ): Promise<Map<number, Person>> {
    if (pageIds.length === 0) return new Map();
    const batchSize = 500;
    const map = new Map<number, Person>();
    for (let i = 0; i < pageIds.length; i += batchSize) {
      const batch = pageIds.slice(i, i + batchSize);
      const persons = await this.personRepository.find({
        where: { wikiPageId: In(batch) },
      });
      for (const p of persons) {
        if (p.wikiPageId) map.set(p.wikiPageId, p);
      }
    }
    this.logger.log(`Batch-loaded ${map.size} existing persons from DB`);
    return map;
  }

  private async fetchCategoryMembers(
    category: string,
  ): Promise<{ pageid: number; title: string }[]> {
    const allMembers: { pageid: number; title: string }[] = [];
    let cmcontinue: string | undefined;

    do {
      const params = new URLSearchParams({
        action: 'query',
        list: 'categorymembers',
        cmtitle: category,
        format: 'json',
        cmlimit: '500',
        cmtype: 'page',
        cmnamespace: '0',
      });
      if (cmcontinue) {
        params.set('cmcontinue', cmcontinue);
      }

      const data = await this.fetchFromWiki(params);
      const members =
        data.query?.categorymembers?.map((m) => ({
          pageid: m.pageid,
          title: m.title,
        })) || [];

      allMembers.push(...members);
      cmcontinue = data?.continue?.cmcontinue;

      if (cmcontinue) {
        await this.sleep(this.REQUEST_DELAY);
      }
    } while (cmcontinue);

    return allMembers.filter((m) => !this.isNonPersonTitle(m.title));
  }

  /**
   * Detect titles that are clearly not individual people:
   * list articles, disambiguation pages, categories, templates, etc.
   */
  private isNonPersonTitle(title: string): boolean {
    const lower = title.toLowerCase();
    const nonPersonPrefixes = [
      'список', 'перелік', 'категорія:', 'шаблон:', 'вікіпедія:',
      'файл:', 'портал:', 'модуль:', 'довідка:', 'медіавікі:',
    ];
    const nonPersonPatterns = [
      /\(значення\)$/,       // disambiguation pages
      /\(термін\)$/,         // terminology pages
      /\bісторія\s/i,        // "Історія ..."
      /\bхронологія\b/i,     // "Хронологія ..."
      /\bнагороди\b/i,       // award list articles
      /\bбібліографія\b/i,   // bibliography articles
    ];

    if (nonPersonPrefixes.some((p) => lower.startsWith(p))) return true;
    if (nonPersonPatterns.some((p) => p.test(title))) return true;
    return false;
  }

  /**
   * Filter members to only include entries that are humans (Wikidata P31 = Q5).
   * Entries already in the DB are assumed valid and pass through.
   */
  private async filterHumansOnly(
    members: RawMember[],
    existingMap?: Map<number, Person>,
  ): Promise<RawMember[]> {
    const result: RawMember[] = [];
    const toCheck: RawMember[] = [];

    for (const member of members) {
      const existing = existingMap?.get(member.pageid);
      if (existing) {
        result.push(member);
      } else {
        toCheck.push(member);
      }
    }

    if (toCheck.length === 0) return result;

    // Get Wikidata IDs for unchecked members
    const wikidataMap = await this.fetchWikidataIds(
      toCheck.map((m) => m.pageid),
    );
    const wdIds = Object.values(wikidataMap);

    if (wdIds.length === 0) return result;

    // SPARQL query: check which Wikidata entities are instance of human (Q5)
    try {
      const idsString = wdIds.map((id) => `wd:${id}`).join(' ');
      const sparqlQuery = `
        SELECT ?person WHERE {
          VALUES ?person { ${idsString} }
          ?person wdt:P31 wd:Q5.
        }
      `;
      const response = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'UkrMapDiplomaBot/1.0 (student_project_test)',
        },
        body: new URLSearchParams({ query: sparqlQuery, format: 'json' }),
        signal: AbortSignal.timeout(this.FETCH_TIMEOUT),
      });

      if (!response.ok) {
        this.logger.warn(
          `Human check SPARQL failed (${response.status}), allowing all entries through`,
        );
        return [...result, ...toCheck];
      }

      const data = await response.json();
      const humanWdIds = new Set<string>(
        data.results.bindings.map((b) => b.person.value.split('/').pop()),
      );

      // Reverse map: wdId → pageId
      const wdToPage = new Map<string, number>();
      for (const [pageId, wdId] of Object.entries(wikidataMap)) {
        wdToPage.set(wdId, Number(pageId));
      }

      for (const member of toCheck) {
        const wdId = wikidataMap[member.pageid];
        if (wdId && humanWdIds.has(wdId)) {
          result.push(member);
        } else if (!wdId) {
          // No Wikidata ID — can't verify, skip to be safe
          this.logger.warn(
            `Skipping "${member.title}" — no Wikidata ID, cannot verify as human`,
          );
        } else {
          this.logger.warn(
            `Filtered out non-human entry: "${member.title}" (${wdId})`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Human check failed: ${error.message}. Allowing all entries through.`,
      );
      return [...result, ...toCheck];
    }

    return result;
  }

  private async fetchPageViews(title: string): Promise<number> {
    const safeTitle = encodeURIComponent(title);
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/uk.wikipedia/all-access/all-agents/${safeTitle}/monthly/2023010100/2024010100`;

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${process.env.WIKIMEDIA_ACCESS_TOKEN}`,
        },
        signal: AbortSignal.timeout(this.FETCH_TIMEOUT),
      });
      if (!res.ok) return 0;
      const data = await res.json();
      return data.items?.reduce((acc, item) => acc + item.views, 0) || 0;
    } catch {
      return 0;
    }
  }

  private async enrichWithViews(
    members: { pageid: number; title: string }[],
    forceRefresh = false,
    existingMap?: Map<number, Person>,
  ): Promise<RawMember[]> {
    const results: RawMember[] = [];
    let fetchedCount = 0;
    let cachedCount = 0;

    for (const member of members) {
      if (!forceRefresh) {
        const existing = existingMap?.get(member.pageid);
        if (existing && existing.views > 0) {
          results.push({ ...member, views: existing.views });
          cachedCount++;
          continue;
        }
      }

      const views = await this.fetchPageViews(member.title);
      results.push({ ...member, views });
      fetchedCount++;
      await this.sleep(this.REQUEST_DELAY / 2);
    }

    if (cachedCount > 0) {
      this.logger.log(`Views: ${cachedCount} cached, ${fetchedCount} fetched from API`);
    }

    return results.sort((a, b) => b.views - a.views);
  }

  private async enrichWithDetails(
    members: RawMember[],
    existingMap?: Map<number, Person>,
  ): Promise<DetailedMember[]> {
    const pageIdsToFetch: number[] = [];
    const enrichedFromDb: DetailedMember[] = [];

    for (const member of members) {
      const existing = existingMap?.get(member.pageid);
      const hasMetaData =
        existing?.meta_data && Object.keys(existing.meta_data).length > 0;
      const isFullyCached =
        existing &&
        existing.lat &&
        !existing.isManual &&
        hasMetaData &&
        existing.summary &&
        existing.imageUrl;
      if (isFullyCached) {
        enrichedFromDb.push({
          ...member,
          birthDate: existing.birthDate,
          birthPlace: existing.birthPlace,
          summary: existing.summary,
          imageUrl: existing.imageUrl,
          occupation: existing.meta_data.occupation,
          deathPlace: existing.meta_data.deathPlace,
          deathDate: existing.meta_data.deathYear
            ? existing.meta_data.deathYear.toString()
            : null,
        });
      } else pageIdsToFetch.push(member.pageid);
    }

    if (pageIdsToFetch.length === 0) return enrichedFromDb;

    const wikidataMap = await this.fetchWikidataIds(pageIdsToFetch);
    const wikidataDetails = await this.fetchSparqlDetails(
      Object.values(wikidataMap),
    );
    const wikiTextDetails = await this.fetchWikiTextDetails(pageIdsToFetch);

    const enrichedFetched = [];
    for (const pageId of pageIdsToFetch) {
      const member = members.find((m) => m.pageid === pageId);
      if (!member) continue;
      const wdId = wikidataMap[pageId];

      const sparqlData = wdId ? wikidataDetails[wdId] : undefined;
      let birthDate = sparqlData?.birthDate || null;
      let birthPlace = sparqlData?.birthPlace || null;

      if (!birthDate || !birthPlace) {
        await this.sleep(this.REQUEST_DELAY);
        const fallback = await this.parseInfoboxHtml(pageId);
        birthDate = birthDate || fallback.birthDate;
        birthPlace = birthPlace || fallback.birthPlace;
      }

      enrichedFetched.push({
        ...member,
        birthDate,
        birthPlace,
        summary: wikiTextDetails[pageId]?.summary,
        imageUrl: wikiTextDetails[pageId]?.image,
        occupation: sparqlData?.occupations || [],
        deathDate: sparqlData?.deathDate || undefined,
      });
    }

    return [...enrichedFromDb, ...enrichedFetched];
  }

  /** In-memory geocode cache: place name → coords. Persists across categories within one sync run. */
  private geocodeCache = new Map<string, { lat: number; lng: number } | null>();

  private async enrichWithCoordinates(
    members: DetailedMember[],
    existingMap?: Map<number, Person>,
  ): Promise<(DetailedMember & { lat: number | null; lng: number | null })[]> {
    const result: (DetailedMember & {
      lat: number | null;
      lng: number | null;
    })[] = [];

    let nominatimCalls = 0;
    let cacheHits = 0;

    for (const member of members) {
      const existing = existingMap?.get(member.pageid);
      if (existing && existing.lat && existing.lng && !existing.isManual) {
        result.push({ ...member, lat: existing.lat, lng: existing.lng });
        continue;
      }

      let coords: { lat: number; lng: number } | null = null;
      if (member.birthPlace && member.birthPlace !== 'Невідомо') {
        const cacheKey = member.birthPlace.toLowerCase().trim();

        if (this.geocodeCache.has(cacheKey)) {
          coords = this.geocodeCache.get(cacheKey)!;
          cacheHits++;
        } else {
          coords = await this.resolveGeoLocation(member.birthPlace);
          this.geocodeCache.set(cacheKey, coords);
          nominatimCalls++;
          await this.sleep(1100); // Nominatim: max 1 req/s
        }
      }

      result.push({
        ...member,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      });
    }

    if (nominatimCalls > 0 || cacheHits > 0) {
      this.logger.log(
        `Geocoding: ${nominatimCalls} Nominatim calls, ${cacheHits} cache hits (cache size: ${this.geocodeCache.size})`,
      );
    }

    return result;
  }

  private async saveOrUpdatePerson(data: WikiPerson) {
    // Use entity resolution for fuzzy deduplication
    const existing = await this.entityResolution.findDuplicate(
      data.title,
      data.pageid,
    );

    if (existing && existing.isManual) {
      this.logger.log(`Skipping manual entry: ${existing.name}`);
      return;
    }

    // Normalize birth place and map category label
    let normalizedBirthPlace = data.birthPlace
      ? this.entityResolution.normalizeBirthPlace(data.birthPlace)
      : null;

    // Validate birthPlace is not just a number (year leak from Wikidata)
    if (normalizedBirthPlace && /^\d+$/.test(normalizedBirthPlace.trim())) {
      this.logger.warn(
        `Invalid birthPlace "${normalizedBirthPlace}" for "${data.title}" — looks like a year, discarding`,
      );
      normalizedBirthPlace = null;
    }

    const categoryLabel = this.entityResolution.mapCategoryLabel(data.category);
    const birthYear = this.entityResolution.extractBirthYear(data.birthDate);

    // Enrich occupation data from metadata if available
    const occupationData = data.occupation
      ? this.entityResolution.enrichOccupations(data.occupation)
      : { occupations: [], primaryCategory: null };

    // Generate slug from name
    const slug = this.entityResolution.toSlug(data.title);

    const payload: any = {
      name: data.title,
      slug,
      wikiPageId: data.pageid,
      category: occupationData.primaryCategory || categoryLabel,
      views: data.views,
      rating: data.rating,
      summary: data.summary || existing?.summary || null,
      imageUrl: data.imageUrl || existing?.imageUrl || null,
      birthDate: data.birthDate,
      birthPlace: normalizedBirthPlace,
      birthYear,
      lat: data.lat,
      lng: data.lng,
      meta_data: {
        ...(existing?.meta_data || {}),
        occupation: occupationData.occupations.length > 0
          ? occupationData.occupations
          : existing?.meta_data?.occupation,
        deathPlace: data.deathPlace || existing?.meta_data?.deathPlace,
        deathYear: data.deathDate
          ? this.entityResolution.extractBirthYear(data.deathDate)
          : existing?.meta_data?.deathYear,
      },
    };

    if (existing) {
      await this.personRepository.update(existing.id, payload);
      if (data.lat && data.lng) {
        await this.personRepository.query(
          `UPDATE person SET "birthLocation" = ST_SetSRID(ST_MakePoint($1, $2), 4326) WHERE id = $3`,
          [data.lng, data.lat, existing.id],
        );
      }
    } else {
      const saved = await this.personRepository.save(payload);
      if (data.lat && data.lng) {
        await this.personRepository.query(
          `UPDATE person SET "birthLocation" = ST_SetSRID(ST_MakePoint($1, $2), 4326) WHERE id = $3`,
          [data.lng, data.lat, saved.id],
        );
      }
    }
  }

  /**
   * Temporary rating used during import for sorting within a category.
   * Final ratings are recalculated by recalculateAllRatings() after sync.
   */
  private calculateRating(views: number): number {
    return Math.min(10, Math.log10(views + 1) * 2);
  }

  /**
   * Recalculate all ratings as percentiles (0-10) based on views across
   * all persons in the database. The person with the highest views gets 10,
   * the lowest gets ~0, and everyone else is distributed proportionally.
   */
  async recalculateAllRatings() {
    this.logger.log('Recalculating ratings (percentile-based)...');

    // Single SQL query: rank each person by views and assign 0-10 rating
    // using percent_rank() which returns 0.0 to 1.0
    await this.personRepository.query(`
      UPDATE person
      SET rating = ROUND((sub.pct * 10)::numeric, 2)
      FROM (
        SELECT id, percent_rank() OVER (ORDER BY views ASC) AS pct
        FROM person
      ) sub
      WHERE person.id = sub.id
    `);

    this.logger.log('Ratings recalculated.');
  }

  private isIgnored(title: string): boolean {
    return this.IGNORED_KEYWORDS.some((word) =>
      title.toLowerCase().includes(word.toLowerCase()),
    );
  }

  private async fetchFromWiki(
    params: URLSearchParams,
    retries = 3,
  ): Promise<any> {
    const url = `${this.WIKIPEDIA_API_URL}?${params.toString()}`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(this.FETCH_TIMEOUT),
      });

      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return res.json();
        }
        // Wikipedia sometimes returns HTML error pages with 200 status
        const text = await res.text();
        if (text.trimStart().startsWith('{')) {
          return JSON.parse(text);
        }
        throw new Error(`Non-JSON response (${contentType})`);
      }

      // Rate-limited or server error — retry with exponential backoff
      if (attempt < retries && (res.status === 429 || res.status >= 500)) {
        const delay = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
        this.logger.warn(
          `Wikipedia returned ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${retries})`,
        );
        await this.sleep(delay);
        continue;
      }

      throw new Error(`Wikipedia API returned HTTP ${res.status}`);
    }
  }

  private async fetchWikidataIds(
    pageIds: number[],
  ): Promise<Record<number, string>> {
    if (pageIds.length === 0) return {};

    const BATCH_SIZE = 50;
    const wikidataMap: Record<number, string> = {};

    for (let i = 0; i < pageIds.length; i += BATCH_SIZE) {
      const batch = pageIds.slice(i, i + BATCH_SIZE);
      try {
        const idsParam = batch.join('|');
        const params = new URLSearchParams({
          action: 'query',
          format: 'json',
          prop: 'pageprops',
          pageids: idsParam,
        });

        const data = await this.fetchFromWiki(params);
        if (!data?.query?.pages) continue;

        for (const pageId in data.query.pages) {
          const page = data.query.pages[pageId];
          if (page.pageprops?.wikibase_item)
            wikidataMap[Number(pageId)] = page.pageprops.wikibase_item;
        }

        if (i + BATCH_SIZE < pageIds.length) {
          await this.sleep(this.REQUEST_DELAY);
        }
      } catch (error) {
        this.logger.error(
          `Error fetching Wikidata IDs (batch ${i / BATCH_SIZE + 1}): ${error.message}`,
        );
      }
    }

    return wikidataMap;
  }

  private async fetchSparqlDetails(
    wdIds: string[],
  ): Promise<
    Record<
      string,
      {
        birthDate: string;
        birthPlace: string;
        occupations: string[];
        deathDate: string | null;
      }
    >
  > {
    if (wdIds.length === 0) return {};

    try {
      const idsString = wdIds.map((id) => `wd:${id}`).join(' ');
      const sparqlQuery = `
        SELECT ?person ?birthdate ?birthplaceLabel ?deathdate
               (GROUP_CONCAT(DISTINCT ?occupationLabel; separator="|") AS ?occupations)
        WHERE {
          VALUES ?person { ${idsString} }
          OPTIONAL { ?person wdt:P569 ?birthdate. }
          OPTIONAL { ?person wdt:P570 ?deathdate. }
          OPTIONAL { ?person wdt:P19 ?birthplace. }
          OPTIONAL {
            ?person wdt:P106 ?occupation.
            ?occupation rdfs:label ?occupationLabel.
            FILTER(LANG(?occupationLabel) = "uk")
          }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "uk". }
        }
        GROUP BY ?person ?birthdate ?birthplaceLabel ?deathdate
      `;
      const response = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'UkrMapDiplomaBot/1.0 (student_project_test)',
        },
        body: new URLSearchParams({
          query: sparqlQuery,
          format: 'json',
        }),
        signal: AbortSignal.timeout(this.FETCH_TIMEOUT),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Status: ${response.status}. Msg: ${errorText}`);
      }

      const data = await response.json();
      const resultMap: Record<
        string,
        {
          birthDate: string;
          birthPlace: string;
          occupations: string[];
          deathDate: string | null;
        }
      > = {};

      for (const result of data.results.bindings) {
        const wikidataId = result.person.value.split('/').pop()!;
        const occupationsStr = result?.occupations?.value || '';
        resultMap[wikidataId] = {
          birthDate: result?.birthdate?.value.split('T')[0] || null,
          birthPlace: result?.birthplaceLabel?.value || null,
          occupations: occupationsStr
            ? occupationsStr.split('|').filter(Boolean)
            : [],
          deathDate: result?.deathdate?.value.split('T')[0] || null,
        };
      }
      return resultMap;
    } catch (error) {
      this.logger.error(`Error fetching SPARQL details: ${error.message}`);
      return {};
    }
  }

  private async fetchWikiTextDetails(
    pageIds: number[],
  ): Promise<Record<number, { summary: string; image: string | null }>> {
    if (pageIds.length === 0) return {};

    const BATCH_SIZE = 5;
    const detailsMap: Record<
      number,
      { summary: string; image: string | null }
    > = {};

    for (let i = 0; i < pageIds.length; i += BATCH_SIZE) {
      const batch = pageIds.slice(i, i + BATCH_SIZE);
      try {
        const idsParam = batch.join('|');
        const params = new URLSearchParams({
          action: 'query',
          format: 'json',
          prop: 'extracts|pageimages',
          exintro: 'true',
          explaintext: 'true',
          piprop: 'original',
          pageids: idsParam,
        });

        const data = await this.fetchFromWiki(params);
        if (!data?.query?.pages) continue;

        for (const pageId in data.query.pages) {
          const page = data.query.pages[pageId];
          detailsMap[Number(pageId)] = {
            summary: page.extract || page.description || null,
            image:
              page.original?.source ||
              page.thumbnail?.source ||
              null,
          };
        }

        if (i + BATCH_SIZE < pageIds.length) {
          await this.sleep(this.REQUEST_DELAY);
        }
      } catch (error) {
        this.logger.error(
          `Error fetching Wiki text details (batch ${i / BATCH_SIZE + 1}): ${error.message}`,
        );
      }
    }

    return detailsMap;
  }

  private async parseInfoboxHtml(
    pageId: number,
  ): Promise<{ birthDate: string | null; birthPlace: string | null }> {
    try {
      const params = new URLSearchParams({
        action: 'parse',
        format: 'json',
        pageid: pageId.toString(),
        prop: 'text',
      });

      const data = await this.fetchFromWiki(params);
      const html = data?.parse?.text?.['*'];

      if (!html) return { birthDate: null, birthPlace: null };

      const dom = new JSDOM(html);
      const document = dom.window.document;
      const infobox = document.querySelector('.infobox');

      let birthDate = null;
      let birthPlace = null;

      if (infobox) {
        const rows = infobox.querySelectorAll('tr');
        rows.forEach((row) => {
          const header = row.querySelector('th');
          const cell = row.querySelector('td');
          if (header && cell) {
            const headerText = header.textContent?.toLowerCase() || '';
            if (
              headerText.includes('дата народження') ||
              headerText.includes('народився')
            ) {
              const dateElem = cell.querySelector(
                '[data-wikidata-property-id="P569"]',
              );
              birthDate =
                dateElem?.textContent?.trim() ||
                cell.textContent?.trim() ||
                null;
            }
            if (
              headerText.includes('місце народження') ||
              headerText.includes('народився')
            ) {
              const placeElem = cell.querySelector(
                '[data-wikidata-property-id="P19"]',
              );
              birthPlace =
                placeElem?.textContent?.trim() ||
                cell.textContent?.trim() ||
                null;
            }
          }
        });
      }
      return { birthDate, birthPlace };
    } catch (error) {
      this.logger.warn(
        `Fallback parsing failed for page ${pageId}: ${error.message}`,
      );
      return { birthDate: null, birthPlace: null };
    }
  }

  private async resolveGeoLocation(
    address: string,
  ): Promise<{ lat: number; lng: number } | null> {
    const cleanAddress = address.replace(/\(.*\)/, '').trim();
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanAddress)}&format=json&limit=1&accept-language=uk`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'UkrMapDiplomaBot/1.0 (student_project)',
        },
        signal: AbortSignal.timeout(this.FETCH_TIMEOUT),
      });
      if (!response.ok) throw new Error(`Nominatim error: ${response.status}`);

      const data = await response.json();
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
        };
      }
      return null;
    } catch (error) {
      this.logger.error(
        `Error geocoding address "${address}": ${error.message}`,
      );
      return null;
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
