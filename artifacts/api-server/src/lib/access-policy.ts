export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export function isConfiguredOwner(email: string, verified: boolean, configuredEmail?: string) {
  return verified && Boolean(configuredEmail?.trim()) && normalizeEmail(email) === normalizeEmail(configuredEmail!);
}
export function isApproved(member: { status: string }) { return member.status === 'approved'; }
export function isAdmin(member: { role: string; status: string }) { return member.role === 'admin' && isApproved(member); }

export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
