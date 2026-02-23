import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { WikipediaService } from '../services/wikipedia.service';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../entities/user.entity';

@ApiTags('wikipedia')
@Controller('wikipedia')
export class WikipediaController {
  constructor(private readonly wikipediaService: WikipediaService) {}

  @Get('famous-people')
  @ApiOperation({
    summary: 'Get famous people from the database (supports pagination)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of records to skip',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max records to return (default: all)',
  })
  async getFamousPeople(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const off = offset ? parseInt(offset, 10) : undefined;
    const lim = limit ? parseInt(limit, 10) : undefined;
    return await this.wikipediaService.getAllPeople(off, lim);
  }

  @Post('sync')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Trigger full Wikipedia sync (admin only)' })
  @ApiQuery({ name: 'forceRefresh', required: false, type: Boolean })
  async syncDatabase(@Query('forceRefresh') forceRefresh?: string) {
    return await this.wikipediaService.startSync(forceRefresh === 'true');
  }

  @Post('sync/stop')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Stop an ongoing Wikipedia sync (admin only)' })
  async stopSync() {
    return this.wikipediaService.stopSync();
  }

  @Get('sync/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check whether a sync is currently running' })
  async getSyncStatus() {
    return this.wikipediaService.getSyncStatus();
  }

  @Post('backfill-death-places')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Backfill death places for existing persons without re-syncing (admin only)',
  })
  async backfillDeathPlaces() {
    return this.wikipediaService.startBackfillDeathPlaces();
  }

  @Post('sync-category')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sync a single category with optional limit (admin only)',
  })
  @ApiQuery({ name: 'category', required: true })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async syncSingleCategory(
    @Query('category') category: string,
    @Query('limit') limit?: string,
  ) {
    return await this.wikipediaService.syncSingleCategory(
      category,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Get('categories')
  @ApiOperation({
    summary: 'Discover all people-related Wikipedia categories dynamically',
  })
  async getCategories() {
    return await this.wikipediaService.getAvailableCategories();
  }

  @Delete('clear-imported')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete all auto-imported persons (keeps manual entries)',
  })
  async clearImported() {
    return await this.wikipediaService.clearImportedPersons();
  }
}
