'use strict';

/**
 * products: SKU master per seller account. SKUs compare exactly (utf8mb4_bin).
 * UNIQUE (seller_account_id, id) lets orders map only to a product of their own account.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`products\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`workspace_id\` BIGINT UNSIGNED NOT NULL,
        \`seller_account_id\` BIGINT UNSIGNED NOT NULL,
        \`sku\` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`catalog_id\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
        \`name\` VARCHAR(512) NULL,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'active',
        \`created_at\` DATETIME(3) NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_products_account_sku\` (\`seller_account_id\`, \`sku\`),
        UNIQUE KEY \`uq_products_account_id\` (\`seller_account_id\`, \`id\`),
        KEY \`ix_products_workspace_account\` (\`workspace_id\`, \`seller_account_id\`),
        CONSTRAINT \`fk_products_account\` FOREIGN KEY (\`workspace_id\`, \`seller_account_id\`)
          REFERENCES \`seller_accounts\` (\`workspace_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`ck_products_status\` CHECK (\`status\` IN ('active', 'archived'))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Products (SKUs) per seller account.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('products');
  },
};
