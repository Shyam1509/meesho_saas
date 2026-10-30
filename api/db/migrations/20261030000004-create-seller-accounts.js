'use strict';

/**
 * seller_accounts: one Meesho seller account, owned by exactly one workspace.
 * UNIQUE (workspace_id, id) is the target of every account-scoped composite foreign key
 * (workspace_id, seller_account_id), so a row can never claim a workspace that does not own its account.
 * No credential columns: the product never stores Meesho passwords, cookies, tokens or OTPs.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`seller_accounts\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`workspace_id\` BIGINT UNSIGNED NOT NULL,
        \`display_name\` VARCHAR(120) NOT NULL,
        \`meesho_supplier_id\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL
          COMMENT 'Supplier identifier as shown in Meesho reports. An identifier, never a credential.',
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'active',
        \`created_at\` DATETIME(3) NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_seller_accounts_workspace_id\` (\`workspace_id\`, \`id\`),
        UNIQUE KEY \`uq_seller_accounts_workspace_display_name\` (\`workspace_id\`, \`display_name\`),
        UNIQUE KEY \`uq_seller_accounts_workspace_supplier\` (\`workspace_id\`, \`meesho_supplier_id\`),
        CONSTRAINT \`fk_seller_accounts_workspace\` FOREIGN KEY (\`workspace_id\`)
          REFERENCES \`workspaces\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`ck_seller_accounts_status\` CHECK (\`status\` IN ('active', 'disabled'))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Meesho seller accounts, one workspace each.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('seller_accounts');
  },
};
