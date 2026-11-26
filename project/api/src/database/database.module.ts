import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { loadEnv } from '../config/env.js';
import { createMikroOrmConfig } from '../config/mikro-orm.config.js';

/** Conexão MikroORM; o middleware de RequestContext dá um EntityManager isolado por requisição. */
@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      driver: PostgreSqlDriver,
      useFactory: () => createMikroOrmConfig(loadEnv()),
    }),
  ],
})
export class DatabaseModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(private readonly orm: MikroORM) {}

  // O v7 conecta sob demanda; sem connect() explícito o checkConnection() do readiness nunca fica ok.
  async onApplicationBootstrap(): Promise<void> {
    await this.orm.connect();
    this.logger.log('Database connection established');
  }
}
