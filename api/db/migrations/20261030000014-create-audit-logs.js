'use strict';

/**
 * audit_logs: append-only trail of manual decisions and data changes (cost changes, manual matches, ...).
 * Scope: none (system), a workspace, or a workspace + one of its accounts. The composite FK keeps the
 * account inside the workspace; fk_audit_logs_workspace still checks workspace-only rows (a composite FK
 * is not checked while seller_account_id is NULL); the CHECK forbids an account without a workspace.
 * actor_user_id NULL = system. before_data/after_data never hold secrets or full source rows.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`audit_logs\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`workspace_id\` BIGINT UNSIGNED NULL,
        \`seller_account_id\` BIGINT UNSIGNED NULL,
        \`actor_user_id\` BIGINT UNSIGNED NULL COMMENT 'NULL = system.',
        \`action\` VARCHAR(64) NOT NULL COMMENT 'e.g. product_cost.created',
        \`entity_type\` VARCHAR(64) NOT NULL,
        \`entity_id\` VARCHAR(64) NOT NULL,
        \`before_data\` JSON NULL,
        \`after_data\` JSON NULL,
        \`request_id\` VARCHAR(64) NULL,
        \`created_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`ix_audit_logs_workspace_created\` (\`workspace_id\`, \`created_at\`),
        KEY \`ix_audit_logs_workspace_account\` (\`workspace_id\`, \`seller_account_id\`),
        KEY \`ix_audit_logs_entity\` (\`entity_type\`, \`entity_id\`),
        KEY \`ix_audit_logs_actor_user\` (\`actor_user_id\`),
        CONSTRAINT \`fk_audit_logs_workspace\` FOREIGN KEY (\`workspace_id\`)
          REFERENCES \`workspaces\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_audit_logs_account\` FOREIGN KEY (\`workspace_id\`, \`seller_account_id\`)
          REFERENCES \`seller_accounts\` (\`workspace_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_audit_logs_actor_user\` FOREIGN KEY (\`actor_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`ck_audit_logs_account_workspace\` CHECK (\`seller_account_id\` IS NULL OR \`workspace_id\` IS NOT NULL)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Append-only audit trail.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_logs');
  },
};
