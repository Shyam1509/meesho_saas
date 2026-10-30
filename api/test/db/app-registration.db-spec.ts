import { getConnectionToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { Sequelize as BaseSequelize } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { AppConfigModule } from '../../src/config/app-config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { MODELS } from '../../src/database/models';
import { assertTestEnvironment } from './sequelize-cli';

/** Own file: Nest's connection re-binds the model classes, so it must not share them with other specs. */
describe('DatabaseModule model registration', () => {
  it('registers all 14 models on the app connection and never calls sync()', async () => {
    assertTestEnvironment();
    const syncSpy = jest.spyOn(BaseSequelize.prototype, 'sync');
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
    }).compile();
    try {
      const sequelize = moduleRef.get<Sequelize>(getConnectionToken());
      expect(Object.keys(sequelize.models).sort()).toEqual(
        MODELS.map((m) => m.name).sort(),
      );
      // Queries work against the migrated tables without any sync.
      await expect(sequelize.models.Order.count()).resolves.toEqual(
        expect.any(Number),
      );
      expect(syncSpy).not.toHaveBeenCalled();
    } finally {
      await moduleRef.close();
      syncSpy.mockRestore();
    }
  });
});
