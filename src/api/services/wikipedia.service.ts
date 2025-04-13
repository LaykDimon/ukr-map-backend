import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { JSDOM } from 'jsdom'; 
import * as fs from 'fs';

@Injectable()
export class WikipediaService {
  private readonly wikipediaApiUrl = 'https://uk.wikipedia.org/w/api.php';
  private readonly categories = [
    'Категорія:Українські науковці', // 320
    'Категорія:Українські письменники', //2306
    'Категорія:Політики України', //903
    'Категорія:Українські художники', //1885
    'Категорія:Українські музиканти', //466
    'Категорія:Українські актори', //811
    'Категорія:Українські спортсмени',//30
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

  constructor() {}

  async getFamousPeopleWithViews() {
    const members = [];
    for (const category of ['Категорія:Українські письменники']) { // once more needed
      try {
        const data = fs.readFileSync(`./ukr_${category.replace(':', '_')}.json`, 'utf8');
        const jsonData = JSON.parse(data);
        const promises = jsonData.map(async (member) => {
          return {
            ...member,
            views: await this.getPersonViews(member.title),
          }
        });
        const results = await Promise.all(promises);
        const finalResults = results.sort((a, b) => b.views - a.views).slice(0, 50); // Sort by views in descending order
        members.push(...finalResults);
        this.saveToFile(finalResults, `./ukr_${category.replace(':', '_')}_views.json`);
      } catch (err) {
        console.error('Error reading or parsing the file:', err);
      }
    }
    return members;
  }

  async getTopFamousPeople() {
    const members = [];
    for (const category of this.categories) {
      const data = fs.readFileSync(`./ukr_${category.replace(':', '_')}_views.json`, 'utf8');
      const jsonData = JSON.parse(data);
      const filteredMembers = jsonData.filter((member) => !members.some((m) => m.id === member.pageid)).map((member) => {
        return {id: member.pageid, name: member.title, views: member.views};
      });
      members.push(...filteredMembers);
    }
    const neededMembers = members.sort((a, b) => b.views - a.views).slice(0, 50); // Sort by views in descending order
    const wikidataMap = await this.getWikidataIds(neededMembers);
    const wikidataIds = Object.values(wikidataMap);
    const birthDetails = await this.getBirthDetails(wikidataIds);
    const wikipediaDetails = await this.getWikipediaDetails(neededMembers);
    const maxViews = neededMembers[0].views;
    const minViews = neededMembers[neededMembers.length - 1].views;
    const MIN_RATING = 2;
    const MAX_RATING = 5;
    const enrichedPeople = await Promise.all(neededMembers.map(async (person) => {
      const wikidataId = wikidataMap[person.id];
      let birthInfo = wikidataId ? birthDetails[wikidataId] : { birthdate: 'Невідомо', birthplace: 'Невідомо' };

      // If either field is unknown, use the fallback method
        if (birthInfo.birthdate === 'Невідомо' || birthInfo.birthplace === 'Невідомо') {
          const fallbackInfo = await this.fallbackParseInfobox(person.id);
          birthInfo = {
            birthdate: birthInfo.birthdate === 'Невідомо' ? fallbackInfo.birthdate : birthInfo.birthdate,
            birthplace: birthInfo.birthplace === 'Невідомо' ? fallbackInfo.birthplace : birthInfo.birthplace,
          };
        }

      const wikiInfo = wikipediaDetails[person.id] || { summary: 'Немає опису', image: null };
      const birthplace = birthInfo.birthplace;
      const rating = MIN_RATING + ((person.views - minViews) / (maxViews - minViews)) * (MAX_RATING - MIN_RATING);

      return {
        name: person.name,
        link: person.link,
        summary: wikiInfo.summary,
        image: wikiInfo.image,
        rating: rating,
        birthdate: birthInfo.birthdate,
        birthplace: birthplace,
      };
    }));

    for (const person of enrichedPeople) {
      if (person.birthplace && person.birthplace !== 'Невідомо') {
        const geocodeResult = await this.geocodeAddress(person.birthplace);
        if (geocodeResult)
          //@ts-ignore
          person.birthplace = geocodeResult;
      }
    }
    await this.saveToFile(enrichedPeople, `./ukr_top_famous_people.json`);
 
    return enrichedPeople;
  }

  async getFamousPeople() {
    const finalMembers = [];

    for (const category of this.categories) {
      const catMembers = [];
      let continueFetching = null;
      do {
        const url = new URL(this.wikipediaApiUrl);
        url.searchParams.append('action', 'query');
        url.searchParams.append('list', 'categorymembers');
        url.searchParams.append('cmtitle', category);
        url.searchParams.append('format', 'json');
        url.searchParams.append('cmlimit', '500');
  
        if (continueFetching)
          url.searchParams.append('cmcontinue', continueFetching); // Use cmcontinue for pagination
  
        const response = await fetch(url.toString());
        if (!response.ok)
          throw new Error('Failed to fetch data from Wikipedia');
  
        const data = await response.json();
        const members = data.query.categorymembers;
        const excludeKeywords = ['список', 'реєстр', 'довідник', 'перелік', 'індекс', 'каталог', 'таблиця', 'дослідники', 'категорія', 'користувач'];
        const filteredMembers = members.filter((member: any) => !excludeKeywords.some(keyword => member.title.toLowerCase().includes(keyword)))
          .map((member) => {
          return {pageid: member.pageid, title: member.title};
        });
        catMembers.push(...filteredMembers);
  
        continueFetching = data.continue ? data.continue.cmcontinue : null;
      } while (continueFetching);
      this.saveToFile(catMembers, `./ukr_${category.replace(':', '_')}.json`);
      finalMembers.push(...catMembers);
    }
   
    return finalMembers;
  }

  async getWikidataIds(people: { id: number; name: string }[]): Promise<Record<number, string>> {
    try {
      const pageIds = people.map(p => p.id).join('|');
      const url = new URL(this.wikipediaApiUrl);
      url.searchParams.append('action', 'query');
      url.searchParams.append('format', 'json');
      url.searchParams.append('prop', 'pageprops');
      url.searchParams.append('pageids', pageIds);

      const response = await fetch(url.toString());
      if (!response.ok) throw new Error('Failed to fetch Wikidata IDs');
      const data = await response.json();
      if (!data || !data.query || !data.query.pages)
        throw new HttpException('Invalid response from Wikipedia API', HttpStatus.INTERNAL_SERVER_ERROR);

      const wikidataMap: Record<number, string> = {};
      for (const pageId in data.query.pages) {
        const page = data.query.pages[pageId];
        if (page.pageprops?.wikibase_item) {
          wikidataMap[Number(pageId)] = page.pageprops.wikibase_item;
        }
      }
      return wikidataMap;
    } catch (error) {
      console.error('Error fetching Wikidata IDs:', error);
      return {};
    }
  }

  async getBirthDetails(wikidataIds: string[]): Promise<Record<string, { birthdate: string; birthplace: string }>> {
    if (wikidataIds.length === 0) return {};
    try {
      const idsString = wikidataIds.map(id => `wd:${id}`).join(' ');
      const sparqlQuery = `
        SELECT ?person ?birthdate ?birthplaceLabel WHERE {
          VALUES ?person { ${idsString} }
          OPTIONAL { ?person wdt:P569 ?birthdate. }
          OPTIONAL { ?person wdt:P19 ?birthplace. }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "uk". }
        }
      `;
      const url = new URL('https://query.wikidata.org/sparql');
      url.searchParams.append('query', sparqlQuery);
      url.searchParams.append('format', 'json');

      const response = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
      if (!response.ok) throw new Error('Failed to fetch birth details');
      const data = await response.json();

      const birthDetailsMap: Record<string, { birthdate: string; birthplace: string }> = {};
      for (const result of data.results.bindings) {
        const wikidataId = result.person.value.split('/').pop()!;
        birthDetailsMap[wikidataId] = {
          birthdate: result?.birthdate?.value.split('T')[0] || 'Невідомо',
          birthplace: result?.birthplaceLabel?.value || 'Невідомо'
        };
      }
      return birthDetailsMap;
    } catch (error) {
      console.error('Error fetching birth details:', error);
      return {};
    }
  }

  async getWikipediaDetails(people: { id: number; name: string }[]): Promise<Record<number, { summary: string; image: string | null }>> {
    try {
      const pageIds = people.map(p => p.id).join('|');
      const url = new URL('https://uk.wikipedia.org/w/api.php');
      url.searchParams.append('action', 'query');
      url.searchParams.append('format', 'json');
      url.searchParams.append('prop', 'extracts|pageimages');
      url.searchParams.append('exintro', 'true');
      url.searchParams.append('explaintext', 'true');
      url.searchParams.append('piprop', 'original');
      url.searchParams.append('pageids', pageIds);

      const response = await fetch(url.toString());
      if (!response.ok) throw new Error('Failed to fetch Wikipedia details');
      const data = await response.json();
      if (!data || !data.query || !data.query.pages)
        throw new HttpException('Invalid response from Wikipedia API', HttpStatus.INTERNAL_SERVER_ERROR);

      const detailsMap: Record<number, { summary: string; image: string | null }> = {};
      for (const pageId in data.query.pages) {
        const page = data.query.pages[pageId];
        detailsMap[Number(pageId)] = {
          summary: page.extract || page.description || 'Немає опису',
          image: page.original?.source || null
        };
      }
      return detailsMap;
    } catch (error) {
      console.error('Error fetching Wikipedia details:', error);
      return {};
    }
  }

  async getPersonViews(articleTitle: string): Promise<number> {
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/uk.wikipedia/all-access/all-agents/${
      encodeURIComponent(articleTitle)}/monthly/2010010100/2025030100`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${process.env.WIKIMEDIA_ACCESS_TOKEN}`,
        }
      });
      if (!response.ok) throw new Error(`Failed to fetch page views for ${articleTitle}`);
      const data = await response.json();
      const views = data.items.reduce((acc: number, item: { views: number }) => acc + item.views, 0) ?? 0;
      return views;
    } catch (error) {
      console.error(`Error fetching views for ${articleTitle}:`, error);
      return 0;
    }
  }

  // Fallback function using jsdom to parse the infobox from Wikipedia HTML
  async fallbackParseInfobox(pageId: number): Promise<{ birthdate: string; birthplace: string }> {
    try {
      const url = new URL('https://uk.wikipedia.org/w/api.php');
      url.searchParams.append('action', 'parse');
      url.searchParams.append('format', 'json');
      url.searchParams.append('pageid', pageId.toString());
      url.searchParams.append('prop', 'text');

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Failed to fetch parse data for page ${pageId}`);
      }
      const data = await response.json();
      const html = data.parse.text['*'];
      const dom = new JSDOM(html);
      const document = dom.window.document;

      // Look for the infobox (a table with class "infobox")
      const infobox = document.querySelector('.infobox');
      let birthdate = 'Невідомо';
      let birthplace = 'Невідомо';

      if (infobox) {
        const rows = infobox.querySelectorAll('tr');
        rows.forEach(row => {
          const header = row.querySelector('th');
          const cell = row.querySelector('td');
          if (header && cell) {
            const headerText = header.textContent?.toLowerCase() || '';
            if (headerText.includes('народився')) {
              const value = cell.textContent?.trim();
              if (value) {
                const birthDateElem = cell.querySelector('[data-wikidata-property-id="P569"]');
                if (birthDateElem && birthDateElem.textContent)
                  birthdate = birthDateElem.textContent.trim();
                const birthPlaceElem = cell.querySelector('[data-wikidata-property-id="P19"]');
                if (birthPlaceElem && birthPlaceElem.textContent)
                  birthplace = birthPlaceElem.textContent.trim();
              }
            }
            else {
              if (headerText.includes('дата народження') || headerText.includes('народився')) {
                birthdate = cell.textContent?.trim() || 'Невідомо';
              }
              if (headerText.includes('місце народження') || headerText.includes('народився')) {
                birthplace = cell.textContent?.trim() || 'Невідомо';
              }
            }
          }
        });
      }
      return { birthdate, birthplace };
    } catch (error) {
      console.error(`Fallback infobox parse error for page ${pageId}:`, error);
      return { birthdate: 'Невідомо', birthplace: 'Невідомо' };
    }
  }

  async geocodeAddress(address) {
    const url = `https://api.geoapify.com/v1/geocode/search?text=${address}&apiKey=${process.env.GEOAPIFY_API_KEY}`
    try {
      const response = await fetch(url, {
        method: 'GET',
      });
      if (!response.ok) {
        throw new Error(`Geocoding request failed: ${response.status}`);
      }
      const data = await response.json();
      if (data && data.features && data.features.length > 0) {
        const result = data.features[0].properties;
        return {
          lat: result.lat,
          lng: result.lon
        };
      }
      return null;
    } catch (error) {
      console.error('Error geocoding address:', error);
      return null;
    }
  }

  async saveToFile(peopleData: any, filePath: string = './all_ukrainians.json') {
    try {
      fs.writeFileSync(filePath, JSON.stringify(peopleData, null, 2));
      console.log('Data saved to file successfully');
    } catch (error) {
      console.error('Error saving data to file:', error);
    }
  }
}
