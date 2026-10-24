import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
// cookie-parser exports a CommonJS function; synthetic default imports fail at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(cookieParser());
  const prefix = config.getOrThrow<string>('API_PREFIX');
  app.setGlobalPrefix(prefix);
  app.enableCors({
    origin: config.getOrThrow<string>('FRONTEND_ORIGIN').split(',').map((origin) => origin.trim()),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('Code Forge API').setDescription('REST API cho demo Code Forge. Git smart HTTP giữ contract giao thức riêng.')
    .setVersion('1.0').addBearerAuth().build());
  SwaggerModule.setup(`${prefix}/openapi`, app, document, { jsonDocumentUrl: `${prefix}/openapi.json` });
  app.enableShutdownHooks();

  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}

void bootstrap();
