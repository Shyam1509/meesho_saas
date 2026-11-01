'use strict';

/**
 * Milestone 7 (dashboard performance): a covering index for "the matched, non-superseded entries of an order
 * and their payment dates" — the first-payment date of the payment-date basis (MIN(payment_date) per order,
 * GROUP BY order) and HAS_SETTLEMENT_SQL (EXISTS per order) read it without touching the table rows.
 * The M2 index ix_settlement_entries_account_order (seller_account_id, order_id) stays: it backs the order FK.
 * One index, one statement; reversible (down drops it). No data change.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE \`settlement_entries\`
        ADD INDEX \`ix_settlement_entries_account_order_payment\`
          (\`seller_account_id\`, \`order_id\`, \`superseded_by_entry_id\`, \`payment_date\`)
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE \`settlement_entries\` DROP INDEX \`ix_settlement_entries_account_order_payment\`
    `);
  },
};
