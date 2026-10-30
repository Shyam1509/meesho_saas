'use strict';

/**
 * workspace_members: user <-> workspace membership with a role.
 * Membership rows are not history: they go with their workspace or user (ON DELETE CASCADE).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`workspace_members\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`workspace_id\` BIGINT UNSIGNED NOT NULL,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`role\` VARCHAR(16) NOT NULL,
        \`created_at\` DATETIME(3) NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_workspace_members_workspace_user\` (\`workspace_id\`, \`user_id\`),
        KEY \`ix_workspace_members_user\` (\`user_id\`),
        CONSTRAINT \`fk_workspace_members_workspace\` FOREIGN KEY (\`workspace_id\`)
          REFERENCES \`workspaces\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT,
        CONSTRAINT \`fk_workspace_members_user\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT,
        CONSTRAINT \`ck_workspace_members_role\` CHECK (\`role\` IN ('owner', 'member'))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Workspace membership and role.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('workspace_members');
  },
};
