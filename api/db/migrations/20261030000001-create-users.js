'use strict';

/**
 * users: people who sign in. Users are disabled (status), never hard-deleted.
 * Login/session handling arrives in Milestone 3; this table only stores the password hash.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`users\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`email\` VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL
          COMMENT 'Unique case-insensitively but accent-sensitively.',
        \`password_hash\` VARCHAR(255) NOT NULL,
        \`display_name\` VARCHAR(120) NULL,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'active',
        \`last_login_at\` DATETIME(3) NULL,
        \`created_at\` DATETIME(3) NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_users_email\` (\`email\`),
        CONSTRAINT \`ck_users_status\` CHECK (\`status\` IN ('active', 'disabled'))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Sign-in identities. Disabled, never hard-deleted.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
