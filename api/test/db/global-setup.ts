import { runSequelizeCli } from './sequelize-cli';

/**
 * Brings meesho_test up to the latest migration before any DB spec runs (a no-op when it already is),
 * so the specs do not depend on file order. The migration round-trip spec leaves it migrated too.
 */
export default function globalSetup(): void {
  runSequelizeCli('db:migrate');
}
