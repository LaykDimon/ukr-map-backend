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
  @ApiOperation({ summary: 'Get all famous people from the database' })
  async getFamousPeople() {
    return await this.wikipediaService.getAllPeople();
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
