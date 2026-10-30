'use strict';

/**
 * product_cost_history: effective-dated unit cost per product.
 * Effective cost on date D = the row with the greatest effective_from <= D. There is no effective_to,
 * so ranges can never overlap; UNIQUE (product_id, effective_from) allows one cost per start date.
 * No row on or before D means the cost is UNKNOWN (never treated as zero).
 * unit_cost has 4 decimals (lot-based costs such as 1000/3); line cost = unit_cost x quantity, rounded
 * half-up to 2 decimals when calculated (M6). Currency is INR only for now (CHECK).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`product_cost_history\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`product_id\` BIGINT UNSIGNED NOT NULL,
        \`unit_cost\` DECIMAL(12,4) NOT NULL,
        \`currency\` CHAR(3) NOT NULL DEFAULT 'INR',
        \`effective_from\` DATE NOT NULL,
        \`note\` VARCHAR(255) NULL,
        \`created_by_user_id\` BIGINT UNSIGNED NOT NULL,
        \`created_at\` DATETIME(3) NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_product_cost_history_product_effective_from\` (\`product_id\`, \`effective_from\`),
        KEY \`ix_product_cost_history_created_by_user\` (\`created_by_user_id\`),
        CONSTRAINT \`fk_product_cost_history_product\` FOREIGN KEY (\`product_id\`)
          REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_product_cost_history_created_by_user\` FOREIGN KEY (\`created_by_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`ck_product_cost_history_unit_cost\` CHECK (\`unit_cost\` >= 0),
        CONSTRAINT \`ck_product_cost_history_currency\` CHECK (\`currency\` = 'INR')
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Effective-dated product unit costs.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('product_cost_history');
  },
};
