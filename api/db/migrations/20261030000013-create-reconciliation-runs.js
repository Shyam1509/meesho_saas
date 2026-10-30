'use strict';

/**
 * reconciliation_runs: one settlement <-> order matching run for a seller account and its counts.
 * Its status changes (running -> completed/failed), so it has updated_at. An 'import' run names its job.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`reconciliation_runs\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`workspace_id\` BIGINT UNSIGNED NOT NULL,
        \`seller_account_id\` BIGINT UNSIGNED NOT NULL,
        \`trigger_type\` VARCHAR(16) NOT NULL,
        \`import_job_id\` BIGINT UNSIGNED NULL,
        \`triggered_by_user_id\` BIGINT UNSIGNED NULL,
        \`status\` VARCHAR(16) NOT NULL,
        \`started_at\` DATETIME(3) NOT NULL,
        \`finished_at\` DATETIME(3) NULL,
        \`matched_count\` INT UNSIGNED NULL,
        \`unmatched_settlement_count\` INT UNSIGNED NULL,
        \`unmatched_order_count\` INT UNSIGNED NULL,
        \`failure_message\` VARCHAR(255) NULL,
        \`created_at\` DATETIME(3) NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`ix_reconciliation_runs_account_started\` (\`seller_account_id\`, \`started_at\`),
        KEY \`ix_reconciliation_runs_workspace_account\` (\`workspace_id\`, \`seller_account_id\`),
        KEY \`ix_reconciliation_runs_account_import_job\` (\`seller_account_id\`, \`import_job_id\`),
        KEY \`ix_reconciliation_runs_triggered_by_user\` (\`triggered_by_user_id\`),
        CONSTRAINT \`fk_reconciliation_runs_account\` FOREIGN KEY (\`workspace_id\`, \`seller_account_id\`)
          REFERENCES \`seller_accounts\` (\`workspace_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_reconciliation_runs_import_job\` FOREIGN KEY (\`seller_account_id\`, \`import_job_id\`)
          REFERENCES \`import_jobs\` (\`seller_account_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_reconciliation_runs_triggered_by_user\` FOREIGN KEY (\`triggered_by_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`ck_reconciliation_runs_trigger_type\` CHECK (\`trigger_type\` IN ('import', 'manual')),
        CONSTRAINT \`ck_reconciliation_runs_import_job\` CHECK (\`trigger_type\` <> 'import' OR \`import_job_id\` IS NOT NULL),
        CONSTRAINT \`ck_reconciliation_runs_status\` CHECK (\`status\` IN ('running', 'completed', 'failed'))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Settlement/order reconciliation runs.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('reconciliation_runs');
  },
};
