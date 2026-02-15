import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  ParseFloatPipe,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SearchService } from '../services/search.service';

@ApiTags('search')
@Controller('persons')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search persons by name (fuzzy, fulltext, or combined)' })
  @ApiQuery({ name: 'q', description: 'Search query string' })
  @ApiQuery({ name: 'type', required: false, enum: ['fuzzy', 'fulltext', 'combined'], description: 'Search type (default: combined)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default: 20)' })
  async search(
    @Query('q') query: string,
    @Query('type', new DefaultValuePipe('combined'))
    type: 'fuzzy' | 'fulltext' | 'combined',
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    if (!query || query.trim().length === 0) {
      return [];
    }
    return this.searchService.search(query, type, limit);
  }

  @Get('geo/radius')
  @ApiOperation({ summary: 'Find persons within a radius from a point' })
  @ApiQuery({ name: 'lat', type: Number, description: 'Center latitude' })
  @ApiQuery({ name: 'lng', type: Number, description: 'Center longitude' })
  @ApiQuery({ name: 'radius', type: Number, description: 'Radius in km' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default: 100)' })
  async searchByRadius(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
    @Query('radius', ParseFloatPipe) radiusKm: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    return this.searchService.searchByRadius(lat, lng, radiusKm, limit);
  }

  @Post('geo/polygon')
  @ApiOperation({ summary: 'Find persons within a GeoJSON polygon' })
  async searchByPolygon(
    @Body() body: { polygon: object; limit?: number },
  ) {
    return this.searchService.searchByPolygon(
      body.polygon,
      body.limit || 100,
    );
  }
}
