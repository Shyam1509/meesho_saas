'use strict';

/** workspaces: the tenant. Owns seller accounts and expenses; users join through workspace_members. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`workspaces\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(120) NOT NULL,
        \`created_by_user_id\` BIGINT UNSIGNED NOT NULL,
        \`created_at\` DATETIME(3) NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`ix_workspaces_created_by_user\` (\`created_by_user_id\`),
        CONSTRAINT \`fk_workspaces_created_by_user\` FOREIGN KEY (\`created_by_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Tenant boundary.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('workspaces');
  },
};
