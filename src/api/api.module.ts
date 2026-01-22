import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WikipediaController } from './controllers/wikipedia.controller';
import { WikipediaService } from './services/wikipedia.service';
import { ConfigModule } from '@nestjs/config';
import { Person } from './entities/person.entity';
import { User } from './entities/user.entity';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Person, User])],
  controllers: [WikipediaController],
  providers: [WikipediaService],
  exports: [WikipediaService],
})
export class ApiModule {}
