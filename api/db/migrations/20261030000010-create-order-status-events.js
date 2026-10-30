'use strict';

/**
 * order_status_events: append-only status observations of an order.
 * Idempotency: UNIQUE (order_id, import_job_id) = one observation per order per import, so
 * re-running the same import adds nothing, while an overlapping report adds a new observation.
 * Account-scoped like the order: every reference is composite, so an event can only cite an order and an
 * import job of its own account, and a source row of that same import job.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`order_status_events\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`workspace_id\` BIGINT UNSIGNED NOT NULL,
        \`seller_account_id\` BIGINT UNSIGNED NOT NULL,
        \`order_id\` BIGINT UNSIGNED NOT NULL,
        \`status\` VARCHAR(64) NOT NULL COMMENT 'Raw source status as observed.',
        \`observed_at\` DATETIME(3) NOT NULL
          COMMENT 'From the report period/generation date when known, else import time (M4).',
        \`import_job_id\` BIGINT UNSIGNED NOT NULL,
        \`import_row_id\` BIGINT UNSIGNED NOT NULL,
        \`created_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_order_status_events_order_import_job\` (\`order_id\`, \`import_job_id\`),
        KEY \`ix_order_status_events_order_observed\` (\`order_id\`, \`observed_at\`),
        KEY \`ix_order_status_events_workspace_account\` (\`workspace_id\`, \`seller_account_id\`),
        KEY \`ix_order_status_events_account_order\` (\`seller_account_id\`, \`order_id\`),
        KEY \`ix_order_status_events_account_import_job\` (\`seller_account_id\`, \`import_job_id\`),
        KEY \`ix_order_status_events_job_row\` (\`import_job_id\`, \`import_row_id\`),
        CONSTRAINT \`fk_order_status_events_account\` FOREIGN KEY (\`workspace_id\`, \`seller_account_id\`)
          REFERENCES \`seller_accounts\` (\`workspace_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_order_status_events_order\` FOREIGN KEY (\`seller_account_id\`, \`order_id\`)
          REFERENCES \`orders\` (\`seller_account_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_order_status_events_import_job\` FOREIGN KEY (\`seller_account_id\`, \`import_job_id\`)
          REFERENCES \`import_jobs\` (\`seller_account_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_order_status_events_import_row\` FOREIGN KEY (\`import_job_id\`, \`import_row_id\`)
          REFERENCES \`import_rows\` (\`import_job_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Append-only order status observations.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('order_status_events');
  },
};
