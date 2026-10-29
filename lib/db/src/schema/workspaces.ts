import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { membersTable } from './members';

export const workspacesTable = pgTable('align_workspaces', {
  userId: text('user_id').primaryKey().references(() => membersTable.id),
  state: jsonb('state').$type<Record<string, unknown>>().notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  legacyImportedAt: timestamp('legacy_imported_at', { withTimezone: true }),
});
export const insertWorkspaceSchema = createInsertSchema(workspacesTable);
export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;
export type WorkspaceRow = typeof workspacesTable.$inferSelect;
