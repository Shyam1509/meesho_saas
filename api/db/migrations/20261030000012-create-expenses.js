'use strict';

/**
 * expenses: manual expenses with explicit scope: the whole workspace (seller_account_id NULL)
 * or one seller account of that workspace (composite FK). Amounts are positive; a refund is not an expense.
 * Currency is INR only for now (CHECK).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`expenses\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`workspace_id\` BIGINT UNSIGNED NOT NULL,
        \`seller_account_id\` BIGINT UNSIGNED NULL,
        \`scope\` VARCHAR(16) NOT NULL,
        \`expense_date\` DATE NOT NULL,
        \`category\` VARCHAR(64) NOT NULL,
        \`description\` VARCHAR(255) NULL,
        \`amount\` DECIMAL(12,2) NOT NULL,
        \`currency\` CHAR(3) NOT NULL DEFAULT 'INR',
        \`created_by_user_id\` BIGINT UNSIGNED NOT NULL,
        \`created_at\` DATETIME(3) NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`ix_expenses_workspace_expense_date\` (\`workspace_id\`, \`expense_date\`),
        KEY \`ix_expenses_account_expense_date\` (\`seller_account_id\`, \`expense_date\`),
        KEY \`ix_expenses_workspace_account\` (\`workspace_id\`, \`seller_account_id\`),
        KEY \`ix_expenses_created_by_user\` (\`created_by_user_id\`),
        CONSTRAINT \`fk_expenses_workspace\` FOREIGN KEY (\`workspace_id\`)
          REFERENCES \`workspaces\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_expenses_account\` FOREIGN KEY (\`workspace_id\`, \`seller_account_id\`)
          REFERENCES \`seller_accounts\` (\`workspace_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_expenses_created_by_user\` FOREIGN KEY (\`created_by_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`ck_expenses_scope\` CHECK (\`scope\` IN ('workspace', 'account')),
        CONSTRAINT \`ck_expenses_scope_account\` CHECK (
          (\`scope\` = 'workspace' AND \`seller_account_id\` IS NULL)
          OR (\`scope\` = 'account' AND \`seller_account_id\` IS NOT NULL)
        ),
        CONSTRAINT \`ck_expenses_amount\` CHECK (\`amount\` > 0),
        CONSTRAINT \`ck_expenses_currency\` CHECK (\`currency\` = 'INR')
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Manual expenses, workspace- or account-scoped.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('expenses');
  },
};
