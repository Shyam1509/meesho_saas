'use strict';

/**
 * Milestone 4 (import pipeline): two nullable columns on import_jobs, in ONE ALTER statement so the
 * migration cannot be left half-applied (MySQL DDL commits implicitly).
 * - data_as_of: when the report's statuses were current. Orders CSV: the "statuses as of" time the user
 *   gave at upload, else the upload time; settlement workbooks: the upload time. order_status_events.observed_at
 *   is this value, and orders' current status moves forward only when it is not older than the order's
 *   current_status_observed_at.
 * - preview_summary: what the parser saw, for the preview screen: sheets, recognised / missing-optional /
 *   ignored column NAMES and planned counts. Never row values.
 * Reversible: down drops both columns (any values in them are lost).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE \`import_jobs\`
        ADD COLUMN \`data_as_of\` DATETIME(3) NULL
          COMMENT 'When the report''s statuses were current: user-provided, else upload time.'
          AFTER \`report_period_end\`,
        ADD COLUMN \`preview_summary\` JSON NULL
          COMMENT 'Parser summary for the preview: sheets, column names, planned counts. No row values.'
          AFTER \`data_as_of\`
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE \`import_jobs\`
        DROP COLUMN \`preview_summary\`,
        DROP COLUMN \`data_as_of\`
    `);
  },
};
