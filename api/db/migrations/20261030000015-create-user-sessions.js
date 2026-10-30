'use strict';

/**
 * user_sessions: server-side sign-in sessions (Milestone 3). The browser holds an opaque random token in an
 * HttpOnly cookie; only its SHA-256 (hex) is stored here, so nothing usable leaks from the database.
 * A session ends when revoked (logout / new login presenting it), idle past SESSION_IDLE_MINUTES since
 * last_used_at, or past absolute_expires_at. No IP address or user agent is stored (data minimisation).
 * Sessions are not history: they go with their user (ON DELETE CASCADE). Expired and revoked rows of a user
 * are deleted at that user's next login.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`user_sessions\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`token_hash\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
          COMMENT 'SHA-256 hex of the session token. The token itself is never stored.',
        \`created_at\` DATETIME(3) NOT NULL,
        \`last_used_at\` DATETIME(3) NOT NULL COMMENT 'Touched at most every 5 minutes; drives the idle timeout.',
        \`absolute_expires_at\` DATETIME(3) NOT NULL,
        \`revoked_at\` DATETIME(3) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_user_sessions_token_hash\` (\`token_hash\`),
        KEY \`ix_user_sessions_user\` (\`user_id\`),
        KEY \`ix_user_sessions_absolute_expires_at\` (\`absolute_expires_at\`),
        CONSTRAINT \`fk_user_sessions_user\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Server-side sign-in sessions (token hashes only).'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_sessions');
  },
};
