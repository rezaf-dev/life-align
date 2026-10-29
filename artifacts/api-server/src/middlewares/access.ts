import { clerkClient, getAuth } from '@clerk/express';
import { db, membersTable, ownerGrantsTable, type Member } from '@workspace/db';
import { eq } from 'drizzle-orm';
import type { Request, RequestHandler } from 'express';
import { AccessError, isAdmin, isApproved, isConfiguredOwner, normalizeEmail } from '../lib/access-policy';
import { ownerIdentifier } from '../lib/owner-bootstrap';

declare global {
  namespace Express {
    interface Request { member?: Member }
  }
}

export async function resolveMember(req: Request): Promise<Member> {
  const auth = getAuth(req);
  const userId = auth.userId;
  if (!userId) throw new AccessError(401, 'Sign in to continue.');
  const [existing] = await db.select().from(membersTable).where(eq(membersTable.id, userId)).limit(1);
  if (existing) return existing;
  const user = await clerkClient.users.getUser(userId).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
      throw new AccessError(401, 'This account no longer exists. Sign in again.');
    }
    throw error;
  });
  const primary = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== 'verified') {
    throw new AccessError(403, 'Verify your email address before requesting access.');
  }
  const email = normalizeEmail(primary.emailAddress);
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || email.split('@')[0];
  return db.transaction(async (tx) => {
    await tx.insert(membersTable).values({ id: userId, email, name, role: 'member', status: 'pending' }).onConflictDoNothing();
    if (isConfiguredOwner(email, true, process.env.ALIGN_OWNER_EMAIL)) {
      // One grant per verified identifier/Clerk environment, never "first signup wins".
      // Keeping this record prevents a restart from undoing deliberate privilege removal.
      const grants = await tx.insert(ownerGrantsTable).values({
        identifier: ownerIdentifier(email), userId,
      }).onConflictDoNothing().returning();
      if (grants.length) {
        await tx.update(membersTable).set({ role: 'admin', status: 'approved', updatedAt: new Date() }).where(eq(membersTable.id, userId));
      }
    }
    const [member] = await tx.select().from(membersTable).where(eq(membersTable.id, userId));
    return member!;
  });
}

export const requireMember: RequestHandler = async (req, _res, next) => {
  try { req.member = await resolveMember(req); next(); } catch (error) { next(error); }
};
export const requireApproved: RequestHandler = async (req, res, next) => {
  try {
    req.member = await resolveMember(req);
    if (!isApproved(req.member)) { res.status(403).json({ error: 'Your account does not have approved access.', status: req.member.status }); return; }
    next();
  } catch (error) { next(error); }
};
export const requireAdmin: RequestHandler = async (req, res, next) => {
  try {
    req.member = await resolveMember(req);
    if (!isAdmin(req.member)) { res.status(403).json({ error: 'Administrator access is required.' }); return; }
    next();
  } catch (error) { next(error); }
};
