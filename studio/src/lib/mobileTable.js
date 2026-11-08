// Phones show only a table's important columns. A table names the columns to drop as
// classes — "m-hide-3" drops its 3rd column — and these CSS rules (placed inside a phone
// media query) hide that column's header and cells. A row whose cell spans columns
// (a placeholder or an expanded detail row) is left alone.
export const MAX_HIDDEN_COLUMN = 12;

export const hideColumnRules = (table, max = MAX_HIDDEN_COLUMN) =>
  Array.from({ length: max }, (_, i) => `${table}.m-hide-${i + 1} tr > :nth-child(${i + 1}):not([colspan])`).join(",\n    ");
