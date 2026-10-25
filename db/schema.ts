import { pgTable, text, bigint, integer, jsonb } from 'drizzle-orm/pg-core';

export const teams = pgTable('teams', {
  pid: text().primaryKey(),
  data: jsonb().notNull().$type<Record<string, unknown>>(),
  updated: bigint({ mode: 'number' }).notNull(),
});

export const sessions = pgTable('facilitator_sessions', {
  id: text().primaryKey(),
  expires: bigint({ mode: 'number' }).notNull(),
  version: text().notNull(),
});

export const attempts = pgTable('facilitator_attempts', {
  id: text().primaryKey(),
  count: integer().notNull(),
  reset: bigint({ mode: 'number' }).notNull(),
});
