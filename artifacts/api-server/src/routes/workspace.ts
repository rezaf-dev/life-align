import { Router, type IRouter } from 'express';
import { db, workspacesTable, ownerGrantsTable } from '@workspace/db';
import { and, eq, sql } from 'drizzle-orm';
import { SaveWorkspaceBody } from '@workspace/api-zod';
import { requireApproved } from '../middlewares/access';
import { stateSchema } from '../lib/planner-state';

const router: IRouter = Router();
router.use('/workspace', requireApproved, (req, res, next) => {
  // The header is only an identity assertion, never a source for selecting data.
  // A queued save from a previous account must not write through a new cookie.
  const expectedUser = req.get('X-Align-User');
  if (expectedUser && expectedUser !== req.member!.id) {
    res.status(409).json({ error: 'The signed-in account changed. No workspace was modified.' }); return;
  }
  next();
});

router.get('/workspace', async (req, res) => {
  const member = req.member!;
  await db.insert(workspacesTable).values({
    userId: member.id,
    state: {
      version: 1, settings: { name: member.name, theme: 'light', sidebarCollapsed: false, onboardedFresh: false },
      goals: [], tasks: [], reviews: [], weekPlans: {}, periodNotes: {},
    },
  }).onConflictDoNothing();
  const [workspace] = await db.select().from(workspacesTable).where(eq(workspacesTable.userId, member.id));
  res.json({ userId: member.id, state: workspace!.state, revision: workspace!.revision, updatedAt: workspace!.updatedAt.toISOString() });
});

router.put('/workspace', async (req, res) => {
  const input = SaveWorkspaceBody.safeParse(req.body);
  const state = input.success ? stateSchema.safeParse(input.data.state) : null;
  if (!input.success || !state?.success) { res.status(400).json({ error: 'Invalid workspace. Your last saved version is unchanged.' }); return; }
  const [saved] = await db.update(workspacesTable).set({
    state: state.data, revision: sql`${workspacesTable.revision} + 1`, updatedAt: new Date(),
  }).where(and(eq(workspacesTable.userId, req.member!.id), eq(workspacesTable.revision, input.data.revision))).returning();
  if (!saved) { res.status(409).json({ error: 'A newer workspace was saved in another tab or device. Download your unsaved backup or reload the saved version.' }); return; }
  res.json({ revision: saved.revision, updatedAt: saved.updatedAt.toISOString() });
});

router.post('/workspace/import', async (req, res) => {
  const [owner] = await db.select().from(ownerGrantsTable).where(eq(ownerGrantsTable.userId, req.member!.id)).limit(1);
  if (!owner || req.member!.role !== 'admin') { res.status(403).json({ error: 'Only the owner can import the previous anonymous browser workspace.' }); return; }
  const input = SaveWorkspaceBody.safeParse(req.body);
  const state = input.success ? stateSchema.safeParse(input.data.state) : null;
  if (!input.success || !state?.success) { res.status(400).json({ error: 'The previous workspace is not a valid backup. Nothing has changed.' }); return; }
  const result = await db.transaction(async (tx) => {
    const [workspace] = await tx.select().from(workspacesTable).where(eq(workspacesTable.userId, req.member!.id)).for('update');
    if (!workspace || workspace.revision !== input.data.revision) return { status: 409, error: 'Your saved workspace changed. Reload it before importing.' };
    if (workspace.legacyImportedAt) return { status: 409, error: 'The previous browser workspace was already imported into this account.' };
    const [saved] = await tx.update(workspacesTable).set({
      state: state.data, revision: workspace.revision + 1, legacyImportedAt: new Date(), updatedAt: new Date(),
    }).where(eq(workspacesTable.userId, req.member!.id)).returning();
    return { saved: saved! };
  });
  if ('error' in result) { res.status(result.status!).json({ error: result.error }); return; }
  res.json({ revision: result.saved.revision, updatedAt: result.saved.updatedAt.toISOString() });
});
export default router;
