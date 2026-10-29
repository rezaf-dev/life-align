import { randomUUID } from 'node:crypto';
import { Router, type IRouter } from 'express';
import { db, membersTable, accessAuditTable, workspacesTable, type Member } from '@workspace/db';
import { eq, desc } from 'drizzle-orm';
import { UpdateMemberAccessBody } from '@workspace/api-zod';
import { requireAdmin, requireMember } from '../middlewares/access';

const router: IRouter = Router();
async function present(member: Member) {
  const [workspace] = member.role === 'admin' ? await db.select({ legacyImportedAt: workspacesTable.legacyImportedAt }).from(workspacesTable).where(eq(workspacesTable.userId, member.id)) : [];
  return {
    id: member.id, email: member.email, name: member.name, role: member.role, status: member.status,
    createdAt: member.createdAt.toISOString(),
    legacyImportAvailable: member.role === 'admin' && !workspace?.legacyImportedAt,
  };
}
router.get('/auth/me', requireMember, async (req, res) => { res.json(await present(req.member!)); });
router.get('/admin/users', requireAdmin, async (_req, res) => {
  const members = await db.select().from(membersTable).orderBy(desc(membersTable.createdAt));
  // Administration intentionally exposes membership only, never another member's workspace.
  res.json(members.map((m) => ({
    id: m.id, email: m.email, name: m.name, role: m.role, status: m.status,
    createdAt: m.createdAt.toISOString(), legacyImportAvailable: false,
  })));
});
router.patch('/admin/users/:id', requireAdmin, async (req, res) => {
  const parsed = UpdateMemberAccessBody.safeParse(req.body);
  if (!parsed.success || Object.keys(req.body).some((k) => k !== 'status')) { res.status(400).json({ error: 'Choose approve, reject, or revoke access.' }); return; }
  const id = String(req.params.id);
  const result = await db.transaction(async (tx) => {
    const [member] = await tx.select().from(membersTable).where(eq(membersTable.id, id)).for('update');
    if (!member) return { status: 404, error: 'Account not found.' };
    if (member.role === 'admin' || member.id === req.member!.id) return { status: 403, error: 'Administrator access cannot be revoked from this screen.' };
    if (member.status === parsed.data.status) return { member };
    const [updated] = await tx.update(membersTable).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(membersTable.id, id)).returning();
    await tx.insert(accessAuditTable).values({ id: randomUUID(), actorId: req.member!.id, memberId: member.id, previousStatus: member.status, status: parsed.data.status });
    return { member: updated! };
  });
  if ('error' in result) { res.status(result.status!).json({ error: result.error }); return; }
  res.json(await present(result.member));
});
export default router;
