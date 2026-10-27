import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import * as cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // XLSX files are converted to structured text before validation. Keep the
  // request limit above the 10 MB upload limit so larger portfolios can be
  // validated without being rejected by Express' 100 KB default.
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ limit: '20mb', extended: true }));

  // Parse cookies for secure http-only session cookies
  app.use(cookieParser());
  
  // Enable CORS with credentials for local web app cookies
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3100,http://127.0.0.1:3100')
    .split(',').map(origin => origin.trim()).filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Enable validation globally
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  // Enable standard error response mapping globally
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('TIC — Gestão de Projetos')
    .setDescription('Documentação das APIs de Fundação, Estrutura Organizacional, Acessos, Cadastros Globais e Recursos.')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'bi-api-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Backend API running on: http://localhost:${port}`);
  console.log(`Swagger docs at: http://localhost:${port}/api/docs`);
}
bootstrap();
