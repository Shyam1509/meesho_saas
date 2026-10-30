'use strict';

/**
 * orders: the canonical order line (one Meesho sub-order) per seller account.
 * Idempotency: UNIQUE (seller_account_id, sub_order_no). Re-imports update the row and add an
 * order_status_events observation instead of creating a duplicate order.
 * Composite FKs keep every reference inside the same account: the owning account (workspace + account),
 * the mapped product, and the first/last import jobs. The current values trace to the exact source row:
 * (last_import_job_id, last_import_row_id) -> import_rows (import_job_id, id).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`orders\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`workspace_id\` BIGINT UNSIGNED NOT NULL,
        \`seller_account_id\` BIGINT UNSIGNED NOT NULL,
        \`sub_order_no\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`order_no\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
        \`order_date\` DATE NOT NULL,
        \`product_id\` BIGINT UNSIGNED NULL,
        \`sku\` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
        \`catalog_id\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
        \`product_name\` VARCHAR(512) NULL,
        \`size\` VARCHAR(64) NULL,
        \`quantity\` INT UNSIGNED NOT NULL,
        \`customer_state\` VARCHAR(64) NULL,
        \`supplier_listed_price\` DECIMAL(12,2) NULL
          COMMENT 'As reported. Per-unit vs line total is decided in M4 from real samples.',
        \`supplier_discounted_price\` DECIMAL(12,2) NULL
          COMMENT 'As reported. Per-unit vs line total is decided in M4 from real samples.',
        \`packet_id\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
        \`current_status\` VARCHAR(64) NOT NULL COMMENT 'Raw source status of the latest observation.',
        \`current_status_observed_at\` DATETIME(3) NOT NULL,
        \`first_import_job_id\` BIGINT UNSIGNED NOT NULL,
        \`last_import_job_id\` BIGINT UNSIGNED NOT NULL,
        \`last_import_row_id\` BIGINT UNSIGNED NOT NULL COMMENT 'Source row of the current values.',
        \`created_at\` DATETIME(3) NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_orders_account_sub_order_no\` (\`seller_account_id\`, \`sub_order_no\`),
        UNIQUE KEY \`uq_orders_account_id\` (\`seller_account_id\`, \`id\`),
        KEY \`ix_orders_workspace_account_order_date\` (\`workspace_id\`, \`seller_account_id\`, \`order_date\`),
        KEY \`ix_orders_account_order_date\` (\`seller_account_id\`, \`order_date\`),
        KEY \`ix_orders_account_current_status\` (\`seller_account_id\`, \`current_status\`),
        KEY \`ix_orders_account_sku\` (\`seller_account_id\`, \`sku\`),
        KEY \`ix_orders_account_product\` (\`seller_account_id\`, \`product_id\`),
        KEY \`ix_orders_account_first_import_job\` (\`seller_account_id\`, \`first_import_job_id\`),
        KEY \`ix_orders_account_last_import_job\` (\`seller_account_id\`, \`last_import_job_id\`),
        KEY \`ix_orders_last_import_job_row\` (\`last_import_job_id\`, \`last_import_row_id\`),
        CONSTRAINT \`fk_orders_account\` FOREIGN KEY (\`workspace_id\`, \`seller_account_id\`)
          REFERENCES \`seller_accounts\` (\`workspace_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_orders_product\` FOREIGN KEY (\`seller_account_id\`, \`product_id\`)
          REFERENCES \`products\` (\`seller_account_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_orders_first_import_job\` FOREIGN KEY (\`seller_account_id\`, \`first_import_job_id\`)
          REFERENCES \`import_jobs\` (\`seller_account_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_orders_last_import_job\` FOREIGN KEY (\`seller_account_id\`, \`last_import_job_id\`)
          REFERENCES \`import_jobs\` (\`seller_account_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_orders_last_import_row\` FOREIGN KEY (\`last_import_job_id\`, \`last_import_row_id\`)
          REFERENCES \`import_rows\` (\`import_job_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`ck_orders_quantity\` CHECK (\`quantity\` > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Canonical order lines (Meesho sub-orders).'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('orders');
  },
};
