'use strict';

/**
 * Milestone 5 (reconciliation): settlement_entries.auto_match_blocked. A manual unmatch sets it to 1 so the
 * automatic matcher (sub order no -> order of the same account) does not redo the match the owner removed;
 * a manual match clears it. Existing rows get 0 (auto-match may consider them).
 * One column, one statement; reversible (down drops it and its values).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE \`settlement_entries\`
        ADD COLUMN \`auto_match_blocked\` TINYINT(1) NOT NULL DEFAULT 0
          COMMENT 'Set by a manual unmatch; auto-match skips the entry.'
          AFTER \`matched_by_user_id\`
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE \`settlement_entries\` DROP COLUMN \`auto_match_blocked\`
    `);
  },
};
