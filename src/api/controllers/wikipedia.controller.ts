import { Controller, Get } from '@nestjs/common';
import { WikipediaService } from '../services/wikipedia.service';

@Controller('wikipedia')
export class WikipediaController {
  constructor(private readonly wikipediaService: WikipediaService) {}

  @Get('famous-people')
  async getFamousPeople() {
    return await this.wikipediaService.getFamousPeople();
  }

  @Get('top-famous-people')
  async getTopFamousPeople() {
    return await this.wikipediaService.getTopFamousPeople();
  }

  @Get('famous-people-details')
  async getFamousPeopleDetails() {
    return await this.wikipediaService.getFamousPeopleWithViews();
  }
}
