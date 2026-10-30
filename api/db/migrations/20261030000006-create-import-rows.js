'use strict';

/**
 * import_rows: staging + traceability for every source row of an import job.
 * Rows go with their job (ON DELETE CASCADE), but canonical tables reference rows with RESTRICT,
 * so a job whose rows became canonical data cannot be deleted. Append-only (created_at only).
 * UNIQUE (import_job_id, id) is the target of the composite (import_job_id, import_row_id) FKs, so a
 * canonical row can only cite a source row of its own import job (and therefore its own account).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`import_rows\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`import_job_id\` BIGINT UNSIGNED NOT NULL,
        \`sheet_name\` VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'Workbook sheet; empty string for CSV files.',
        \`source_row_number\` INT UNSIGNED NOT NULL COMMENT 'Row number as the user sees it in the file.',
        \`status\` VARCHAR(16) NOT NULL,
        \`action\` VARCHAR(16) NULL,
        \`errors\` JSON NULL COMMENT 'Array of {field, reason}.',
        \`source_values\` JSON NULL COMMENT 'Normalized source values for traceability.',
        \`row_hash\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
        \`created_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_import_rows_job_sheet_row\` (\`import_job_id\`, \`sheet_name\`, \`source_row_number\`),
        UNIQUE KEY \`uq_import_rows_job_id\` (\`import_job_id\`, \`id\`),
        CONSTRAINT \`fk_import_rows_import_job\` FOREIGN KEY (\`import_job_id\`)
          REFERENCES \`import_jobs\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT,
        CONSTRAINT \`ck_import_rows_status\` CHECK (\`status\` IN ('valid', 'error', 'skipped', 'imported')),
        CONSTRAINT \`ck_import_rows_action\` CHECK (\`action\` IS NULL OR \`action\` IN ('insert', 'update', 'unchanged', 'status_event'))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Source rows of an import job, with row-level errors.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('import_rows');
  },
};
