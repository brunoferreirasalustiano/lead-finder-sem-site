import postgres from 'postgres';
export const connect = (url: string) => postgres(url, { max: 1, prepare: true, idle_timeout: 5 });
export function databaseUrl(): string { const value = process.env['DATABASE_URL']; if (!value) throw new Error('DATABASE_URL_REQUIRED'); return value; }
