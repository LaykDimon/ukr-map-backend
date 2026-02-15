import {
  Controller,
  Get,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { StatisticsService } from '../services/statistics.service';

@ApiTags('statistics')
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('temporal')
  @ApiOperation({ summary: 'Get birth year distribution by decade' })
  async getTemporalDistribution() {
    return this.statisticsService.getTemporalDistribution();
  }

  @Get('geo')
  @ApiOperation({ summary: 'Get geographic distribution by birth place' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default: 20)' })
  async getGeoDistribution(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.statisticsService.getGeoDistribution(limit);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Get category distribution' })
  async getCategoryDistribution() {
    return this.statisticsService.getCategoryDistribution();
  }

  @Get('overview')
  @ApiOperation({ summary: 'Get overall statistics summary' })
  async getOverview() {
    return this.statisticsService.getOverview();
  }
}
