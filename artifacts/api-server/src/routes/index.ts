import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import accountsRouter from './accounts';
import workspaceRouter from './workspace';

const router: IRouter = Router();
router.use((req, res, next) => {
  // Account-bound responses must never be reused from a previous sign-in.
  res.set('Cache-Control', 'no-store, private');
  res.vary('Cookie');
  const origin = req.get('origin');
  const host = req.get('x-forwarded-host')?.split(',')[0]?.trim() || req.get('host');
  if (origin) {
    let valid = false;
    try { valid = new URL(origin).host === host; } catch { /* reject malformed/null origins */ }
    if (!valid) { res.status(403).json({ error: 'Use this application directly.' }); return; }
  }
  next();
});

router.use(healthRouter);
router.use(aiRouter);
router.use(accountsRouter);
router.use(workspaceRouter);

export default router;
