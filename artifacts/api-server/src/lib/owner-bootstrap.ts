import { clerkClient } from '@clerk/express';
import { parsePublishableKey } from '@clerk/shared/keys';
import { db, membersTable, ownerGrantsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { normalizeEmail } from './access-policy';

export function ownerIdentifier(email: string) {
  const key = parsePublishableKey(process.env.CLERK_PUBLISHABLE_KEY);
  if (!key?.frontendApi) throw new Error('Clerk is not configured.');
  return `${key.frontendApi}|${normalizeEmail(email)}`;
}

/** Runs in each target environment with that environment's Clerk identities.
 * No shared passwords; the trusted owner can sign in using email verification.
 * Grant records make restarts idempotent and do not restore removed privileges.
 */
export async function seedConfiguredOwner() {
  const email = process.env.ALIGN_OWNER_EMAIL?.trim();
  if (!email) throw new Error('ALIGN_OWNER_EMAIL must be configured before starting Align.');
  const identifier = ownerIdentifier(email);
  const [done] = await db.select().from(ownerGrantsTable).where(eq(ownerGrantsTable.identifier, identifier)).limit(1);
  if (done) return;
  const results = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
  let user = results.data.find((u) => u.emailAddresses.some((e) => normalizeEmail(e.emailAddress) === normalizeEmail(email)));
  if (!user) {
    // The app owner explicitly supplied this trusted email. Clerk verifies it at sign-in.
    user = await clerkClient.users.createUser({ emailAddress: [email], skipPasswordRequirement: true });
  }
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  if (!primary || normalizeEmail(primary.emailAddress) !== normalizeEmail(email) || primary.verification?.status !== 'verified') return;
  await db.transaction(async (tx) => {
    await tx.insert(membersTable).values({
      id: user!.id, email: normalizeEmail(primary.emailAddress),
      name: [user!.firstName, user!.lastName].filter(Boolean).join(' ') || email.split('@')[0],
      role: 'member', status: 'pending',
    }).onConflictDoNothing();
    const granted = await tx.insert(ownerGrantsTable).values({ identifier, userId: user!.id }).onConflictDoNothing().returning();
    if (granted.length) await tx.update(membersTable).set({ role: 'admin', status: 'approved', updatedAt: new Date() }).where(eq(membersTable.id, user!.id));
  });
}
