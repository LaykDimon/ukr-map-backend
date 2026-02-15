import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './api/filters/http-exception.filter';
import { EtagInterceptor } from './api/interceptors/etag.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new EtagInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('UkrMap API')
    .setDescription('API for the Ukrainian Cultural Heritage Map')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentication endpoints')
    .addTag('wikipedia', 'Wikipedia data sync')
    .addTag('persons', 'Person CRUD operations')
    .addTag('search', 'Search and geo-queries')
    .addTag('statistics', 'Statistical data')
    .addTag('import-logs', 'Import log history')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const dataSource = app.get(DataSource);
  const queries = [
    // Enable PostGIS extension
    `CREATE EXTENSION IF NOT EXISTS postgis;`,
    // Enable trigram extension for fuzzy search (Step 6)
    `CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
    // GIN index on meta_data JSONB
    `CREATE INDEX IF NOT EXISTS idx_person_meta_data_gin ON person USING GIN (meta_data);`,
    // GIST index on birthLocation geometry
    `CREATE INDEX IF NOT EXISTS idx_person_birth_location_gist ON person USING GIST ("birthLocation");`,
    // Trigram GIN index on name for fuzzy search
    `CREATE INDEX IF NOT EXISTS idx_person_name_trgm ON person USING GIN (name gin_trgm_ops);`,
    // Populate birthLocation from existing lat/lng where missing
    `UPDATE person SET "birthLocation" = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
     WHERE lat IS NOT NULL AND lng IS NOT NULL AND "birthLocation" IS NULL;`,
  ];

  for (const query of queries) {
    await dataSource.query(query).catch((err) => {
      console.warn(`DB init query warning: ${err.message}`);
    });
  }

  await app.listen(process.env.PORT ?? 8000);
}
bootstrap();
