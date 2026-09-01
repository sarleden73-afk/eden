// Postgres/Supabase columns are snake_case; the app's TS types are camelCase.
export function toSnakeCase(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const snakeKey = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    out[snakeKey] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

export function toCamelCase<T = any>(obj: Record<string, any>): T {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    out[camelKey] = value;
  }
  return out as T;
}

export function toCamelCaseArray<T = any>(rows: Record<string, any>[]): T[] {
  return rows.map((row) => toCamelCase<T>(row));
}
