'use strict';

/**
 * import_jobs: one uploaded report file for one seller account (preview -> confirm -> import).
 * Job-level idempotency: active_file_sha256 (STORED generated) equals file_sha256 only while the job is
 * 'importing' or 'completed', and UNIQUE (seller_account_id, report_type, active_file_sha256) allows one
 * active/completed import per file per account and report type. Pending, previewed, failed and cancelled
 * jobs (NULL there) stay retryable. (seller_account_id, file_sha256) stays a plain index to find earlier
 * uploads of the same file in any status. Canonical rows are idempotent on their own keys as well.
 * UNIQUE (seller_account_id, id) lets account-scoped tables reference a job of their own account only.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`import_jobs\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`workspace_id\` BIGINT UNSIGNED NOT NULL,
        \`seller_account_id\` BIGINT UNSIGNED NOT NULL,
        \`created_by_user_id\` BIGINT UNSIGNED NOT NULL,
        \`confirmed_by_user_id\` BIGINT UNSIGNED NULL,
        \`report_type\` VARCHAR(32) NOT NULL,
        \`status\` VARCHAR(16) NOT NULL,
        \`original_filename\` VARCHAR(255) NOT NULL,
        \`file_size_bytes\` BIGINT UNSIGNED NOT NULL,
        \`file_sha256\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        \`active_file_sha256\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin
          GENERATED ALWAYS AS (IF(\`status\` IN ('importing', 'completed'), \`file_sha256\`, NULL)) STORED
          COMMENT 'file_sha256 while importing/completed, else NULL. Backs the one-active-import rule.',
        \`report_period_start\` DATE NULL COMMENT 'Period covered by the report, when known.',
        \`report_period_end\` DATE NULL,
        \`storage_key\` VARCHAR(512) NULL,
        \`total_rows\` INT UNSIGNED NULL,
        \`valid_rows\` INT UNSIGNED NULL,
        \`error_rows\` INT UNSIGNED NULL,
        \`inserted_count\` INT UNSIGNED NULL,
        \`updated_count\` INT UNSIGNED NULL,
        \`unchanged_count\` INT UNSIGNED NULL,
        \`failure_code\` VARCHAR(64) NULL,
        \`failure_message\` VARCHAR(255) NULL,
        \`previewed_at\` DATETIME(3) NULL,
        \`confirmed_at\` DATETIME(3) NULL,
        \`completed_at\` DATETIME(3) NULL,
        \`created_at\` DATETIME(3) NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_import_jobs_account_id\` (\`seller_account_id\`, \`id\`),
        UNIQUE KEY \`uq_import_jobs_account_report_active_sha256\` (\`seller_account_id\`, \`report_type\`, \`active_file_sha256\`),
        KEY \`ix_import_jobs_account_sha256\` (\`seller_account_id\`, \`file_sha256\`),
        KEY \`ix_import_jobs_workspace_account_created\` (\`workspace_id\`, \`seller_account_id\`, \`created_at\`),
        KEY \`ix_import_jobs_created_by_user\` (\`created_by_user_id\`),
        KEY \`ix_import_jobs_confirmed_by_user\` (\`confirmed_by_user_id\`),
        CONSTRAINT \`fk_import_jobs_account\` FOREIGN KEY (\`workspace_id\`, \`seller_account_id\`)
          REFERENCES \`seller_accounts\` (\`workspace_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_import_jobs_created_by_user\` FOREIGN KEY (\`created_by_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_import_jobs_confirmed_by_user\` FOREIGN KEY (\`confirmed_by_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`ck_import_jobs_report_type\` CHECK (\`report_type\` IN ('orders_csv', 'settlement_xlsx')),
        CONSTRAINT \`ck_import_jobs_status\` CHECK (\`status\` IN ('pending', 'previewed', 'importing', 'completed', 'failed', 'cancelled')),
        CONSTRAINT \`ck_import_jobs_report_period\` CHECK (
          \`report_period_start\` IS NULL OR \`report_period_end\` IS NULL
          OR \`report_period_end\` >= \`report_period_start\`
        )
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Uploaded report files and their import lifecycle.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('import_jobs');
  },
};
