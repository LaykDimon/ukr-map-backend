import { Controller, Get, Post } from '@nestjs/common';
import { WikipediaService } from '../services/wikipedia.service';

@Controller('wikipedia')
export class WikipediaController {
  constructor(private readonly wikipediaService: WikipediaService) {}

  @Get('famous-people')
  async getFamousPeople() {
    return await this.wikipediaService.getAllPeople();
  }

  @Post('sync')
  async syncDatabase() {
    return await this.wikipediaService.startSync();
  }
}
