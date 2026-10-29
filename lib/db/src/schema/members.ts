import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';

export const membersTable = pgTable('align_members', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('member'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const ownerGrantsTable = pgTable('align_owner_grants', {
  identifier: text('identifier').primaryKey(),
  userId: text('user_id').notNull().references(() => membersTable.id),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
});
export const accessAuditTable = pgTable('align_access_audit', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull().references(() => membersTable.id),
  memberId: text('member_id').notNull().references(() => membersTable.id),
  previousStatus: text('previous_status').notNull(),
  status: text('status').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
export const insertMemberSchema = createInsertSchema(membersTable);
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
