import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WikipediaController } from './controllers/wikipedia.controller';
import { WikipediaService } from './services/wikipedia.service';
import { PersonsController } from './controllers/persons.controller';
import { PersonsService } from './services/persons.service';
import { SearchController } from './controllers/search.controller';
import { SearchService } from './services/search.service';
import { StatisticsController } from './controllers/statistics.controller';
import { StatisticsService } from './services/statistics.service';
import { ImportLogsController } from './controllers/import-logs.controller';
import { ProposedEditsController } from './controllers/proposed-edits.controller';
import { ProposedEditsService } from './services/proposed-edits.service';
import { EntityResolutionService } from './services/entity-resolution.service';
import { UsersController } from './controllers/users.controller';
import { UsersService } from './services/users.service';
import { ConfigModule } from '@nestjs/config';
import { Person } from './entities/person.entity';
import { User } from './entities/user.entity';
import { ImportLog } from './entities/import-log.entity';
import { ProposedEdit } from './entities/proposed-edit.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Person, User, ImportLog, ProposedEdit]),
  ],
  controllers: [
    WikipediaController,
    SearchController,
    PersonsController,
    ProposedEditsController,
    StatisticsController,
    ImportLogsController,
    UsersController,
  ],
  providers: [
    WikipediaService,
    PersonsService,
    SearchService,
    StatisticsService,
    ProposedEditsService,
    EntityResolutionService,
    UsersService,
  ],
  exports: [
    WikipediaService,
    PersonsService,
    SearchService,
    StatisticsService,
    ProposedEditsService,
    EntityResolutionService,
    UsersService,
  ],
})
export class ApiModule {}
