import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { ApiModule } from './api/api.module';
import { WikipediaController } from './api/controllers/wikipedia.controller';
import { WikipediaService } from './api/services/wikipedia.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ApiModule
  ],
  controllers: [AppController, WikipediaController],
  providers: [AppService, WikipediaService],
})
export class AppModule {}
