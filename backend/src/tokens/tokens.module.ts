import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';

@Module({ imports: [AuthModule], controllers: [TokensController], providers: [TokensService], exports: [TokensService] })
export class TokensModule {}
