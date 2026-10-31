/**
 * A Date as a MySQL DATETIME(3) literal in UTC ('YYYY-MM-DD HH:mm:ss.SSS'), for raw SQL replacements.
 * Sequelize formats a Date replacement in the machine's local time zone, while the connection (and every
 * model) stores UTC; passing this string instead keeps raw-SQL writes in UTC like the models.
 */
export function utcDatetime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}
