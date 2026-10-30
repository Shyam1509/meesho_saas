'use strict';

/**
 * Milestone 4 review (contract v2): orders rows that were older than the order's current observation only
 * add a status event ("history only"). They get their own count instead of being folded into
 * unchanged_count. NULL until the import completes (and for jobs completed before this column existed).
 * One nullable column, one statement; reversible (down drops it and its values).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE \`import_jobs\`
        ADD COLUMN \`history_only_count\` INT UNSIGNED NULL
          COMMENT 'Rows of an older report recorded as status history only.'
          AFTER \`unchanged_count\`
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE \`import_jobs\` DROP COLUMN \`history_only_count\`
    `);
  },
};
