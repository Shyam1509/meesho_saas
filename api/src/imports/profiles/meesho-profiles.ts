import type { SettlementEntryType } from '../../database/models';

/**
 * ALL header knowledge of the importer lives in this file, versioned as a whole.
 *
 * Built from the column names listed in the blueprint (§8), NOT from real Meesho files (none were
 * available): verify against real exports and add aliases here, bumping PROFILE_VERSION. The preview
 * shows recognised / missing-optional / ignored columns and sheets, so drift is visible to the user.
 *
 * Matching (header-matcher.ts): a header is normalised to lower-case a–z/0–9 only
 * ("Supplier Listed Price (Incl. GST + Commission)" → "supplierlistedpriceinclgstcommission") and matches a
 * field when it equals one of the field's aliases (normalised the same way) or starts with one of its
 * `prefixes` without starting with one of its `excludePrefixes`. An exact alias match wins over a prefix
 * match. Two columns matching the same field reject the file.
 *
 * Version 2: Order Payments requires Transaction ID and Payment Date columns (their cells may be blank),
 * because the settlement fingerprint (v2) covers exactly each sheet's REQUIRED fields.
 */
export const PROFILE_VERSION = 2;

export type FieldKind =
  'id' | 'text' | 'status' | 'date' | 'decimal' | 'quantity';

export interface FieldSpec {
  /** Key in import_rows.source_values and in row errors. */
  key: string;
  /** Shown in messages ("Missing required column ..."). */
  label: string;
  kind: FieldKind;
  /** The column must be present in the file. */
  required: boolean;
  /** Only with required: the column must exist but its cells may be blank (NULL). */
  blankAllowed?: boolean;
  /** id / text / status: maximum length in characters. */
  maxLength?: number;
  /** Header spellings (any case/punctuation). The first one is the label. */
  aliases: readonly string[];
  /** Already-normalised header prefixes. */
  prefixes?: readonly string[];
  /** Already-normalised prefixes that must NOT match this field (e.g. a percentage next to an amount). */
  excludePrefixes?: readonly string[];
}

/** Settlement sheets of the "Compensation and Recovery" kind decide the entry type per row. */
export const COMPENSATION_OR_RECOVERY = 'compensation_or_recovery';
export type SheetEntryType =
  SettlementEntryType | typeof COMPENSATION_OR_RECOVERY;

export interface SheetProfile {
  /** Stable key used in the settlement fingerprint (so sheet-name variants do not create duplicates). */
  key: string;
  /** Sheet names (normalised like headers when matching). */
  names: readonly string[];
  entryType: SheetEntryType;
  /**
   * Fields in fingerprint order. The settlement fingerprint (v2) covers the sheet key, the entry type and the
   * values of the REQUIRED fields only, so optional columns (present, absent, renamed, zero or blank) never
   * change it.
   */
  fields: readonly FieldSpec[];
}

/** Keys of a sheet's required fields, in profile order: what fingerprint v2 covers. */
export function fingerprintFields(profile: SheetProfile): string[] {
  return profile.fields.filter((f) => f.required).map((f) => f.key);
}

const ID = 64;
const NAME = 255;

const SUB_ORDER_NO_ALIASES = [
  'Sub Order No',
  'Sub Order Number',
  'Suborder No',
] as const;

/** Orders CSV (`orders_csv`). */
export const ORDERS_CSV_FIELDS: readonly FieldSpec[] = [
  {
    key: 'subOrderNo',
    label: 'Sub Order No',
    kind: 'id',
    required: true,
    maxLength: ID,
    aliases: SUB_ORDER_NO_ALIASES,
  },
  {
    key: 'status',
    label: 'Reason for Credit Entry',
    kind: 'status',
    required: true,
    maxLength: 64,
    aliases: ['Reason for Credit Entry', 'Order Status', 'Status'],
  },
  {
    key: 'orderDate',
    label: 'Order Date',
    kind: 'date',
    required: true,
    aliases: ['Order Date'],
  },
  {
    key: 'quantity',
    label: 'Quantity',
    kind: 'quantity',
    required: true,
    aliases: ['Quantity', 'Qty'],
  },
  {
    key: 'orderNo',
    label: 'Order No',
    kind: 'id',
    required: false,
    maxLength: ID,
    aliases: ['Order No', 'Order ID'],
  },
  {
    key: 'catalogId',
    label: 'Catalog ID',
    kind: 'id',
    required: false,
    maxLength: ID,
    aliases: ['Catalog ID'],
  },
  {
    key: 'customerState',
    label: 'Customer State',
    kind: 'text',
    required: false,
    maxLength: 64,
    aliases: ['Customer State'],
  },
  {
    key: 'productName',
    label: 'Product Name',
    kind: 'text',
    required: false,
    maxLength: NAME,
    aliases: ['Product Name'],
  },
  {
    key: 'sku',
    label: 'SKU',
    kind: 'id',
    required: false,
    // orders.sku / products.sku are VARCHAR(128).
    maxLength: 128,
    aliases: ['SKU', 'Supplier SKU'],
  },
  {
    key: 'size',
    label: 'Size',
    kind: 'text',
    required: false,
    maxLength: 64,
    aliases: ['Size'],
  },
  {
    key: 'supplierListedPrice',
    label: 'Supplier Listed Price',
    kind: 'decimal',
    required: false,
    aliases: ['Supplier Listed Price'],
    prefixes: ['supplierlistedprice'],
  },
  {
    key: 'supplierDiscountedPrice',
    label: 'Supplier Discounted Price',
    kind: 'decimal',
    required: false,
    aliases: ['Supplier Discounted Price'],
    prefixes: ['supplierdiscountedprice'],
  },
  {
    key: 'packetId',
    label: 'Packet Id',
    kind: 'id',
    required: false,
    maxLength: ID,
    aliases: ['Packet Id'],
  },
];

const TRANSACTION_ID: FieldSpec = {
  key: 'transactionId',
  label: 'Transaction ID',
  kind: 'id',
  required: false,
  maxLength: ID,
  aliases: ['Transaction ID'],
};

const OPTIONAL_SUB_ORDER_NO: FieldSpec = {
  key: 'subOrderNo',
  label: 'Sub Order No',
  kind: 'id',
  required: false,
  maxLength: ID,
  aliases: SUB_ORDER_NO_ALIASES,
};

/** Settlement workbook (`settlement_xlsx`): one profile per recognised sheet. */
export const SETTLEMENT_SHEET_PROFILES: readonly SheetProfile[] = [
  {
    key: 'order_payments',
    names: ['Order Payments', 'Order Payment'],
    entryType: 'order_payment',
    fields: [
      { ...OPTIONAL_SUB_ORDER_NO, required: true },
      { ...TRANSACTION_ID, required: true, blankAllowed: true },
      {
        key: 'paymentDate',
        label: 'Payment Date',
        kind: 'date',
        required: true,
        blankAllowed: true,
        aliases: ['Payment Date'],
      },
      {
        key: 'settlementAmount',
        label: 'Final Settlement Amount',
        kind: 'decimal',
        required: true,
        aliases: ['Final Settlement Amount'],
      },
      {
        key: 'orderDate',
        label: 'Order Date',
        kind: 'date',
        required: false,
        aliases: ['Order Date'],
      },
      {
        key: 'saleAmount',
        label: 'Total Sale Amount',
        kind: 'decimal',
        required: false,
        aliases: ['Total Sale Amount'],
        prefixes: ['totalsaleamount'],
      },
      {
        key: 'returnAmount',
        label: 'Total Sale Return Amount',
        kind: 'decimal',
        required: false,
        aliases: ['Total Sale Return Amount'],
        prefixes: ['totalsalereturnamount'],
      },
      {
        key: 'commissionAmount',
        label: 'Meesho Commission',
        kind: 'decimal',
        required: false,
        aliases: ['Meesho Commission'],
        prefixes: ['meeshocommission'],
        excludePrefixes: ['meeshocommissionpercentage'],
      },
      {
        key: 'shippingCharge',
        label: 'Shipping Charge',
        kind: 'decimal',
        required: false,
        aliases: ['Shipping Charge'],
        prefixes: ['shippingcharge'],
      },
      {
        key: 'tcsAmount',
        label: 'TCS',
        kind: 'decimal',
        required: false,
        aliases: ['TCS'],
      },
      {
        key: 'tdsAmount',
        label: 'TDS',
        kind: 'decimal',
        required: false,
        aliases: ['TDS'],
      },
      {
        key: 'recoveryAmount',
        label: 'Recovery',
        kind: 'decimal',
        required: false,
        aliases: ['Recovery'],
      },
      {
        key: 'compensationAmount',
        label: 'Compensation',
        kind: 'decimal',
        required: false,
        aliases: ['Compensation'],
      },
    ],
  },
  {
    key: 'ads_cost',
    names: ['Ads Cost', 'Ads Costs', 'Ad Cost'],
    entryType: 'ads_cost',
    fields: [
      {
        key: 'settlementAmount',
        label: 'Total Ads Cost',
        kind: 'decimal',
        required: true,
        aliases: ['Total Ads Cost', 'Ads Cost'],
        prefixes: ['totaladscost'],
      },
      {
        key: 'paymentDate',
        label: 'Deduction Date',
        kind: 'date',
        required: true,
        aliases: ['Deduction Date', 'Payment Date', 'Date'],
      },
      { ...TRANSACTION_ID, aliases: ['Transaction ID', 'Campaign ID'] },
    ],
  },
  {
    key: 'referral_payments',
    names: ['Referral Payments', 'Referral Payment'],
    entryType: 'referral_payment',
    fields: [
      {
        key: 'settlementAmount',
        label: 'Net Referral Amount',
        kind: 'decimal',
        required: true,
        aliases: ['Net Referral Amount', 'Referral Amount', 'Amount'],
      },
      {
        key: 'paymentDate',
        label: 'Payment Date',
        kind: 'date',
        required: true,
        aliases: ['Payment Date', 'Date'],
      },
      TRANSACTION_ID,
      OPTIONAL_SUB_ORDER_NO,
    ],
  },
  {
    key: 'compensation_recovery',
    names: ['Compensation and Recovery', 'Compensation & Recovery'],
    entryType: COMPENSATION_OR_RECOVERY,
    fields: [
      {
        key: 'settlementAmount',
        label: 'Amount',
        kind: 'decimal',
        required: true,
        aliases: ['Amount', 'Net Amount'],
      },
      {
        key: 'paymentDate',
        label: 'Payment Date',
        kind: 'date',
        required: true,
        aliases: ['Payment Date', 'Date'],
      },
      TRANSACTION_ID,
      OPTIONAL_SUB_ORDER_NO,
      // Decides compensation vs recovery; a free-text "Reason" column is deliberately NOT mapped.
      {
        key: 'typeLabel',
        label: 'Type',
        kind: 'text',
        required: false,
        maxLength: 64,
        aliases: ['Type', 'Category'],
      },
    ],
  },
];
