import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Person } from '../entities/person.entity';
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
  private readonly REQUEST_DELAY = 200;

  private readonly CATEGORIES = [
    'Категорія:Українські науковці',
    'Категорія:Українські письменники',
    'Категорія:Політики України',
    'Категорія:Українські художники',
    'Категорія:Українські музиканти',
    'Категорія:Українські актори',
    'Категорія:Українські спортсмени',
    'Категорія:Українські підприємці',
    'Категорія:Українські громадські діячі',
    'Категорія:Українські філософи',
    'Категорія:Українські історики',
    'Категорія:Українські журналісти',
    'Категорія:Українські військовики',
    'Категорія:Українські дипломати',
    'Категорія:Українські релігійні діячі',
    'Категорія:Українські співаки',
    'Категорія:Українські телеведучі',
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
  ) {}

  async getAllPeople(): Promise<Person[]> {
    return this.personRepository.find({
      order: { rating: 'DESC' },
      take: 2000,
    });
  }

  async startSync() {
    this.logger.log('Manual sync started...');
    this.runFullSyncPipeline().catch((err) => this.logger.error(err));
    return { status: 'Sync started in background' };
  }

  @Cron(CronExpression.EVERY_WEEK)
  async handleCron() {
    this.logger.log('Cron job started: Updating database...');
    await this.runFullSyncPipeline();
  }

  private async runFullSyncPipeline() {
    for (const category of this.CATEGORIES) {
      try {
        const people = await this.processCategory(category);
        for (const p of people) await this.saveOrUpdatePerson(p);
        await this.sleep(2000);
      } catch (e) {
        this.logger.error(
          `Failed to process category ${category}: ${e.message}`,
        );
      }
    }
    this.logger.log('Full sync completed!');
  }

  async processCategory(categoryName: string): Promise<WikiPerson[]> {
    this.logger.log(`Processing category: ${categoryName}`);

    const rawMembers = await this.fetchCategoryMembers(categoryName);
    const filteredMembers = rawMembers.filter((m) => !this.isIgnored(m.title));
    this.logger.log(`Found ${filteredMembers.length} valid pages.`);

    const popularMembers = await this.enrichWithViews(filteredMembers);
    const topMembers = popularMembers.slice(0, 50);
    const detailedMembers = await this.enrichWithDetails(topMembers);

    const geocodedMembers = await this.enrichWithCoordinates(detailedMembers);
    return geocodedMembers.map((person) => ({
      ...person,
      category: categoryName,
      rating: this.calculateRating(person.views),
    }));
  }

  private async fetchCategoryMembers(
    category: string,
  ): Promise<{ pageid: number; title: string }[]> {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: category,
      format: 'json',
      cmlimit: '500',
    });

    const data = await this.fetchFromWiki(params);
    return (
      data.query?.categorymembers?.map((m) => ({
        pageid: m.pageid,
        title: m.title,
      })) || []
    );
  }

  private async fetchPageViews(title: string): Promise<number> {
    const safeTitle = encodeURIComponent(title);
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/uk.wikipedia/all-access/all-agents/${safeTitle}/monthly/2023010100/2024010100`;

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${process.env.WIKIMEDIA_ACCESS_TOKEN}`,
        },
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
  ): Promise<RawMember[]> {
    const results = [];
    for (const member of members) {
      const views = await this.fetchPageViews(member.title);
      results.push({ ...member, views });
      await this.sleep(this.REQUEST_DELAY / 2);
    }
    return results.sort((a, b) => b.views - a.views);
  }

  private async enrichWithDetails(
    members: RawMember[],
  ): Promise<DetailedMember[]> {
    const pageIdsToFetch: number[] = [];
    const enrichedFromDb: DetailedMember[] = [];

    for (const member of members) {
      const existing = await this.personRepository.findOne({
        where: { wikiPageId: member.pageid },
      });
      if (
        existing &&
        existing.birthDate &&
        existing.birthPlace &&
        !existing.isManual
      ) {
        enrichedFromDb.push({
          ...member,
          birthDate: existing.birthDate,
          birthPlace: existing.birthPlace,
          summary: existing.summary,
          imageUrl: existing.imageUrl,
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

      let details:
        | { birthDate: string | null; birthPlace: string | null }
        | undefined = wdId ? wikidataDetails[wdId] : undefined;
      if (!details) details = { birthDate: null, birthPlace: null };

      if (!details.birthDate || !details.birthPlace) {
        await this.sleep(this.REQUEST_DELAY);
        const fallback = await this.parseInfoboxHtml(pageId);
        details = {
          birthDate: details.birthDate || fallback.birthDate,
          birthPlace: details.birthPlace || fallback.birthPlace,
        };
      }

      enrichedFetched.push({
        ...member,
        birthDate: details.birthDate,
        birthPlace: details.birthPlace,
        summary: wikiTextDetails[pageId]?.summary,
        imageUrl: wikiTextDetails[pageId]?.image,
      });
    }

    return [...enrichedFromDb, ...enrichedFetched];
  }

  private async enrichWithCoordinates(
    members: DetailedMember[],
  ): Promise<(DetailedMember & { lat: number | null; lng: number | null })[]> {
    const result: (DetailedMember & {
      lat: number | null;
      lng: number | null;
    })[] = [];
    for (const member of members) {
      const existing = await this.personRepository.findOne({
        where: { wikiPageId: member.pageid },
      });
      if (existing && existing.lat && existing.lng && !existing.isManual) {
        result.push({ ...member, lat: existing.lat, lng: existing.lng });
        continue;
      }
      let coords = { lat: null, lng: null };
      if (member.birthPlace && member.birthPlace !== 'Невідомо') {
        const resolved = await this.resolveGeoLocation(member.birthPlace);
        if (resolved) coords = resolved;
        await this.sleep(this.REQUEST_DELAY * 2);
      }
      result.push({ ...member, ...coords });
    }
    return result;
  }

  private async saveOrUpdatePerson(data: WikiPerson) {
    const existing = await this.personRepository.findOne({
      where: [{ wikiPageId: data.pageid }, { name: data.title }],
    });

    if (existing && existing.isManual) {
      this.logger.log(`Skipping manual entry: ${existing.name}`);
      return;
    }

    const payload = {
      name: data.title,
      wikiPageId: data.pageid,
      category: data.category,
      views: data.views,
      rating: data.rating,
      summary: data.summary,
      imageUrl: data.imageUrl,
      birthDate: data.birthDate,
      birthPlace: data.birthPlace,
      lat: data.lat,
      lng: data.lng,
    };

    if (existing) await this.personRepository.update(existing.id, payload);
    else await this.personRepository.save(payload);
  }

  private calculateRating(views: number): number {
    return Math.min(10, Math.log10(views + 1) * 2);
  }

  private isIgnored(title: string): boolean {
    return this.IGNORED_KEYWORDS.some((word) =>
      title.toLowerCase().includes(word.toLowerCase()),
    );
  }

  private async fetchFromWiki(params: URLSearchParams) {
    const url = `${this.WIKIPEDIA_API_URL}?${params.toString()}`;
    const res = await fetch(url);
    return res.json();
  }

  private async fetchWikidataIds(
    pageIds: number[],
  ): Promise<Record<number, string>> {
    if (pageIds.length === 0) return {};

    try {
      const idsParam = pageIds.join('|');
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'pageprops',
        pageids: idsParam,
      });

      const data = await this.fetchFromWiki(params);
      if (!data?.query?.pages) return {};

      const wikidataMap: Record<number, string> = {};
      for (const pageId in data.query.pages) {
        const page = data.query.pages[pageId];
        if (page.pageprops?.wikibase_item)
          wikidataMap[Number(pageId)] = page.pageprops.wikibase_item;
      }
      return wikidataMap;
    } catch (error) {
      this.logger.error(`Error fetching Wikidata IDs: ${error.message}`);
      return {};
    }
  }

  private async fetchSparqlDetails(
    wdIds: string[],
  ): Promise<Record<string, { birthDate: string; birthPlace: string }>> {
    if (wdIds.length === 0) return {};

    try {
      const idsString = wdIds.map((id) => `wd:${id}`).join(' ');
      const sparqlQuery = `
        SELECT ?person ?birthdate ?birthplaceLabel WHERE {
          VALUES ?person { ${idsString} }
          OPTIONAL { ?person wdt:P569 ?birthdate. }
          OPTIONAL { ?person wdt:P19 ?birthplace. }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "uk". }
        }
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
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Status: ${response.status}. Msg: ${errorText}`);
      }

      const data = await response.json();
      const resultMap: Record<
        string,
        { birthDate: string; birthPlace: string }
      > = {};

      for (const result of data.results.bindings) {
        const wikidataId = result.person.value.split('/').pop()!;
        resultMap[wikidataId] = {
          birthDate: result?.birthdate?.value.split('T')[0] || null,
          birthPlace: result?.birthplaceLabel?.value || null,
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

    try {
      const idsParam = pageIds.join('|');
      const url = `https://uk.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageimages&exintro=true&explaintext=true&piprop=original&pageids=${idsParam}`;

      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch Wiki details');

      const data = await response.json();
      if (!data?.query?.pages) return {};

      const detailsMap: Record<
        number,
        { summary: string; image: string | null }
      > = {};
      for (const pageId in data.query.pages) {
        const page = data.query.pages[pageId];
        detailsMap[Number(pageId)] = {
          summary: page.extract || page.description || null,
          image: page.original?.source || null,
        };
      }
      return detailsMap;
    } catch (error) {
      this.logger.error(`Error fetching Wiki text details: ${error.message}`);
      return {};
    }
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
    if (!process.env.GEOAPIFY_API_KEY) {
      this.logger.warn('Geoapify API key is missing');
      return null;
    }

    const cleanAddress = address.replace(/\(.*\)/, '').trim();
    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(cleanAddress)}&apiKey=${process.env.GEOAPIFY_API_KEY}`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Geoapify error: ${response.status}`);

      const data = await response.json();
      if (data && data.features && data.features.length > 0) {
        const props = data.features[0].properties;
        return {
          lat: props.lat,
          lng: props.lon,
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
