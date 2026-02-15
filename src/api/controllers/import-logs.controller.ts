import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImportLog } from '../entities/import-log.entity';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../entities/user.entity';

@ApiTags('import-logs')
@Controller('import-logs')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class ImportLogsController {
  constructor(
    @InjectRepository(ImportLog)
    private importLogRepository: Repository<ImportLog>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get import log history (admin only)' })
  async findAll() {
    return this.importLogRepository.find({
      order: { importedAt: 'DESC' },
      take: 100,
    });
  }
}
