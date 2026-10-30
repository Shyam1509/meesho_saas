'use strict';

/**
 * settlement_entries: one row of a settlement workbook sheet, per seller account.
 * transaction_id is NOT unique (Meesho repeats it). Idempotency: UNIQUE (seller_account_id, entry_fingerprint),
 * where entry_fingerprint = sha256 over a FIXED, versioned field list (fingerprint_version) plus the row's
 * occurrence index among identical rows in the same file. Re-importing the same file or an overlapping
 * report is a no-op, while two genuinely separate rows with the same transaction ID stay separate.
 * Every reference is composite: the import job and the matched order belong to the same account, the
 * source row belongs to that import job, and superseded_by_entry_id points to an entry of the same account.
 * Matching: order_id and match_method are set together; a match records when (and, if manual, who).
 * Not enforceable here: superseded_by_entry_id <> id (MySQL rejects CHECKs on AUTO_INCREMENT columns,
 * error 3818); the M5 supersession code must refuse self-references and cycles.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE \`settlement_entries\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`workspace_id\` BIGINT UNSIGNED NOT NULL,
        \`seller_account_id\` BIGINT UNSIGNED NOT NULL,
        \`import_job_id\` BIGINT UNSIGNED NOT NULL,
        \`import_row_id\` BIGINT UNSIGNED NOT NULL,
        \`sheet_name\` VARCHAR(64) NOT NULL,
        \`entry_type\` VARCHAR(32) NOT NULL,
        \`transaction_id\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
        \`sub_order_no\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
        \`order_id\` BIGINT UNSIGNED NULL,
        \`order_date\` DATE NULL,
        \`payment_date\` DATE NULL,
        \`settlement_amount\` DECIMAL(12,2) NOT NULL COMMENT 'Settlement effect of the row, as reported.',
        \`sale_amount\` DECIMAL(12,2) NULL,
        \`return_amount\` DECIMAL(12,2) NULL,
        \`commission_amount\` DECIMAL(12,2) NULL,
        \`shipping_charge\` DECIMAL(12,2) NULL,
        \`tcs_amount\` DECIMAL(12,2) NULL,
        \`tds_amount\` DECIMAL(12,2) NULL,
        \`recovery_amount\` DECIMAL(12,2) NULL,
        \`compensation_amount\` DECIMAL(12,2) NULL,
        \`is_estimate\` BOOLEAN NOT NULL DEFAULT FALSE,
        \`entry_fingerprint\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
          COMMENT 'sha256 of the fixed, versioned normalized field list + occurrence index in the file.',
        \`fingerprint_version\` SMALLINT UNSIGNED NOT NULL COMMENT 'Field-list version used for entry_fingerprint.',
        \`superseded_by_entry_id\` BIGINT UNSIGNED NULL
          COMMENT 'Set when a later entry replaces this one; totals use only rows where this is NULL.',
        \`match_method\` VARCHAR(16) NULL,
        \`matched_at\` DATETIME(3) NULL,
        \`matched_by_user_id\` BIGINT UNSIGNED NULL,
        \`created_at\` DATETIME(3) NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_settlement_entries_account_fingerprint\` (\`seller_account_id\`, \`entry_fingerprint\`),
        UNIQUE KEY \`uq_settlement_entries_account_id\` (\`seller_account_id\`, \`id\`),
        KEY \`ix_settlement_entries_account_transaction\` (\`seller_account_id\`, \`transaction_id\`),
        KEY \`ix_settlement_entries_account_sub_order_no\` (\`seller_account_id\`, \`sub_order_no\`),
        KEY \`ix_settlement_entries_account_payment_date\` (\`seller_account_id\`, \`payment_date\`),
        KEY \`ix_settlement_entries_account_order_date\` (\`seller_account_id\`, \`order_date\`),
        KEY \`ix_settlement_entries_workspace_account\` (\`workspace_id\`, \`seller_account_id\`),
        KEY \`ix_settlement_entries_account_order\` (\`seller_account_id\`, \`order_id\`),
        KEY \`ix_settlement_entries_account_import_job\` (\`seller_account_id\`, \`import_job_id\`),
        KEY \`ix_settlement_entries_job_row\` (\`import_job_id\`, \`import_row_id\`),
        KEY \`ix_settlement_entries_account_superseded_by\` (\`seller_account_id\`, \`superseded_by_entry_id\`),
        KEY \`ix_settlement_entries_matched_by_user\` (\`matched_by_user_id\`),
        CONSTRAINT \`fk_settlement_entries_account\` FOREIGN KEY (\`workspace_id\`, \`seller_account_id\`)
          REFERENCES \`seller_accounts\` (\`workspace_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_settlement_entries_import_job\` FOREIGN KEY (\`seller_account_id\`, \`import_job_id\`)
          REFERENCES \`import_jobs\` (\`seller_account_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_settlement_entries_import_row\` FOREIGN KEY (\`import_job_id\`, \`import_row_id\`)
          REFERENCES \`import_rows\` (\`import_job_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_settlement_entries_order\` FOREIGN KEY (\`seller_account_id\`, \`order_id\`)
          REFERENCES \`orders\` (\`seller_account_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_settlement_entries_superseded_by\` FOREIGN KEY (\`seller_account_id\`, \`superseded_by_entry_id\`)
          REFERENCES \`settlement_entries\` (\`seller_account_id\`, \`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_settlement_entries_matched_by_user\` FOREIGN KEY (\`matched_by_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`ck_settlement_entries_entry_type\` CHECK (\`entry_type\` IN ('order_payment', 'ads_cost', 'referral_payment', 'compensation', 'recovery', 'other')),
        CONSTRAINT \`ck_settlement_entries_match_method\` CHECK (\`match_method\` IS NULL OR \`match_method\` IN ('auto', 'manual')),
        CONSTRAINT \`ck_settlement_entries_match_consistency\` CHECK ((\`match_method\` IS NULL) = (\`order_id\` IS NULL)),
        CONSTRAINT \`ck_settlement_entries_manual_match\` CHECK (
          \`match_method\` IS NULL OR \`match_method\` <> 'manual'
          OR (\`matched_by_user_id\` IS NOT NULL AND \`matched_at\` IS NOT NULL)
        ),
        CONSTRAINT \`ck_settlement_entries_auto_match\` CHECK (
          \`match_method\` IS NULL OR \`match_method\` <> 'auto' OR \`matched_at\` IS NOT NULL
        )
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='Settlement workbook rows. transaction_id is not unique.'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('settlement_entries');
  },
};
