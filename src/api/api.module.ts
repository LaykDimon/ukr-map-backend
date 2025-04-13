import { Module } from '@nestjs/common';
import { WikipediaController } from './controllers/wikipedia.controller';
import { WikipediaService } from './services/wikipedia.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [WikipediaController],
  providers: [WikipediaService]
})
export class ApiModule {}
