/**
 * Which date puts a row into a date range (Milestone 7): the order date or the payment date. The dashboard
 * defaults to `order_date`; the settlements list keeps its Milestone 5 meaning (`payment_date`) by default.
 */
export const DATE_BASES = ['order_date', 'payment_date'] as const;
export type DateBasis = (typeof DATE_BASES)[number];
