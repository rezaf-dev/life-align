import { useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { ChevronDown, Download, Moon, RotateCcw, Sparkles, Sun, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, FormDialog } from '@/components/form-dialog';
import { AreaSelect } from '@/components/goal-dialogs';
import { PageHeader, Section } from '@/components/primitives';
import { addDaysIso, todayIso } from '@/lib/dates';
import { exportJson, importJson, removeSampleData, restoreSample, setSettings, startFresh, type GoalInput } from '@/lib/store/actions';
import { useAppState } from '@/lib/store/store';
import type { Area } from '@/lib/store/types';
import { cn } from '@/lib/utils';
import { useAccess } from '@/components/auth/access-provider';
import { hasLegacyWorkspace, importLegacyWorkspace } from '@/lib/workspace-sync';

const LEGACY_KEYS = ['align.workspace.v1'];
function legacyPreview(): { goals: number; tasks: number; reviews: number } | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !LEGACY_KEYS.some((x) => k.startsWith(x))) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? 'null');
      const st = v?.state ?? v;
      if (st && Array.isArray(st.goals)) return { goals: st.goals.length, tasks: (st.tasks ?? []).length, reviews: (st.reviews ?? []).length };
    }
  } catch { /* preview is best-effort */ }
  return null;
}

function LegacyImportCard({ onBackup }: { onBackup: () => void }) {
  const { member } = useAccess();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (member?.role !== 'admin' || !member.legacyImportAvailable || !hasLegacyWorkspace() || done) return null;
  const preview = legacyPreview();
  return (
    <section className="surface rise border-primary/30 p-5 md:p-6" data-testid="card-legacy-import">
      <div className="eyebrow mb-1 text-primary">Owner only</div>
      <h2 className="font-display text-xl">Import this browser’s previous workspace</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Before accounts existed, Align saved a workspace in this browser{preview ? <> containing <span className="font-num" data-testid="text-legacy-counts">{preview.goals} goals, {preview.tasks} tasks and {preview.reviews} reviews</span></> : ''}. Importing replaces your account’s current workspace. The browser copy is left untouched.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={onBackup} data-testid="button-legacy-backup"><Download /> Back up current first</Button>
        <Button disabled={busy} onClick={() => setConfirm(true)} data-testid="button-legacy-import"><Upload /> {busy ? 'Importing…' : 'Import into my account'}</Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Replace your account workspace?"
        description="Your account’s current goals, tasks and reviews will be replaced by the previous browser workspace. Download a backup first if you might want them back."
        confirmLabel="Import and replace"
        destructive
        onConfirm={async () => {
          setBusy(true);
          try { await importLegacyWorkspace(); setDone(true); toast({ title: 'Previous workspace imported' }); }
          catch (e) { toast({ title: 'Import failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }); }
          finally { setBusy(false); }
        }}
      />
    </section>
  );
}

export default function SettingsPage() {
  const state = useAppState();
  const { toast } = useToast();
  const [name, setName] = useState(state.settings.name);
  const [confirm, setConfirm] = useState<null | 'remove' | 'restore' | 'import'>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const demo = {
    goals: state.goals.filter((g) => g.isDemo).length,
    tasks: state.tasks.filter((t) => t.isDemo).length,
    reviews: state.reviews.filter((r) => r.isDemo).length,
  };
  const own = {
    goals: state.goals.length - demo.goals,
    tasks: state.tasks.length - demo.tasks,
    reviews: state.reviews.length - demo.reviews,
  };
  const hasDemo = demo.goals + demo.tasks + demo.reviews > 0;

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `align-backup-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Backup downloaded' });
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="Your workspace is private to your account and saves automatically. Export a backup whenever it matters." />
      <div className="space-y-6">
        <Section title="You">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); setSettings({ name: name.trim() }); toast({ title: 'Name saved' }); }}>
            <Field label="Your name, used in greetings" htmlFor="set-name" className="flex-1">
              <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-settings-name" />
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="outline" disabled={name.trim() === state.settings.name} data-testid="button-save-name">Save</Button>
              <span className="min-w-[4rem] text-xs text-muted-foreground" aria-live="polite" data-testid="text-name-state">{name.trim() === state.settings.name ? (state.settings.name ? 'Saved' : '') : 'Unsaved'}</span>
            </div>
          </form>
        </Section>

        <Section title="Appearance">
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={state.settings.theme === t}
                onClick={() => setSettings({ theme: t })}
                data-testid={`button-theme-${t}`}
                className={cn('flex items-center gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', state.settings.theme === t ? 'border-primary bg-accent/50' : 'border-border hover:border-foreground/30')}
              >
                <span className={cn('grid size-10 place-items-center rounded-lg border', t === 'light' ? 'border-[hsl(38_18%_85%)] bg-[hsl(42_33%_96%)] text-[hsl(224_24%_14%)]' : 'border-[hsl(228_11%_20%)] bg-[hsl(228_16%_9%)] text-[hsl(40_22%_89%)]')}>
                  {t === 'light' ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </span>
                <span>
                  <span className="block font-medium capitalize">{t === 'light' ? 'Paper' : 'Ink'}</span>
                  <span className="text-xs text-muted-foreground">{t === 'light' ? 'Warm light — default' : 'Low-light evenings'}</span>
                </span>
              </button>
            ))}
          </div>
          <label className="mt-4 flex items-center justify-between text-sm">
            <span>Compact sidebar</span>
            <input type="checkbox" checked={state.settings.sidebarCollapsed} onChange={(e) => setSettings({ sidebarCollapsed: e.target.checked })} className="size-4 accent-[hsl(var(--primary))]" data-testid="checkbox-sidebar-compact" />
          </label>
        </Section>

        <LegacyImportCard onBackup={download} />

        <Section title="Backup">
          <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
            <div className="bg-card p-4">
              <div className="eyebrow mb-1">Yours</div>
              <p className="font-num text-sm" data-testid="text-own-counts">{own.goals} goals &middot; {own.tasks} tasks &middot; {own.reviews} reviews</p>
            </div>
            <div className="bg-card p-4">
              <div className="eyebrow mb-1">Sample items</div>
              <p className="font-num text-sm" data-testid="text-demo-counts">{demo.goals} goals &middot; {demo.tasks} tasks &middot; {demo.reviews} reviews</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={download} data-testid="button-export"><Download /> Export backup</Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="button-import"><Upload /> Restore from backup</Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setPendingImport(await f.text());
                setConfirm('import');
              }}
              data-testid="input-import-file"
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Your workspace is saved to your private account. A backup file is a portable copy you keep yourself.</p>
        </Section>

        <details className="surface rise group p-5 md:p-6" data-testid="details-reset">
          <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span>
              <span className="block font-display text-xl">Reset and sample data</span>
              <span className="block text-xs text-muted-foreground">Start fresh, remove sample items, or restore the sample workspace.{hasDemo ? '' : ' No sample items right now.'}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-5 space-y-4 border-t border-border pt-5">
            <Row title="Start fresh" body="Set up to three of your own goals. You choose whether sample data stays." action={<Button variant="outline" onClick={() => setOnboarding(true)} data-testid="button-start-fresh"><Sparkles /> Start fresh</Button>} />
            <div className="space-y-4 rounded-lg border border-destructive/30 bg-destructive/[0.03] p-4">
              <Row title="Remove sample data" body={hasDemo ? 'Deletes only items marked as sample. Your own goals, tasks and reviews stay.' : 'Nothing to remove. There are no sample items.'} action={<Button variant="outline" disabled={!hasDemo} onClick={() => setConfirm('remove')} className="text-destructive" data-testid="button-remove-sample"><Trash2 /> Remove sample</Button>} />
              <Row title="Restore sample workspace" body="Replaces everything, including your own data, with the original sample. Export a backup first." action={<Button variant="outline" onClick={() => setConfirm('restore')} className="text-destructive" data-testid="button-restore-sample"><RotateCcw /> Restore sample</Button>} />
            </div>
          </div>
        </details>

        <Section title="How Align works">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>Reminders are in-app only. Align has no background notification service; due reminders appear on Overview and the Day plan when the app is open.</li>
            <li>What needs a decision items come from simple rules using only your stored data. Hover the info icon to see the rule. There is no AI.</li>
                      </ul>
        </Section>
      </div>

      <ConfirmDialog open={confirm === 'remove'} onOpenChange={(o) => !o && setConfirm(null)} title="Remove all sample data?" description={`This permanently deletes ${demo.goals} sample goals, ${demo.tasks} sample tasks and ${demo.reviews} sample reviews. Your own items are kept.`} confirmLabel="Remove sample data" destructive onConfirm={() => { removeSampleData(); toast({ title: 'Sample data removed' }); }} />
      <ConfirmDialog open={confirm === 'restore'} onOpenChange={(o) => !o && setConfirm(null)} title="Replace everything with the sample?" description={`All current data — including ${own.goals} of your goals and ${own.tasks} of your tasks — will be overwritten. This cannot be undone.`} confirmLabel="Replace with sample" destructive onConfirm={() => { restoreSample(); setName(state.settings.name); toast({ title: 'Sample workspace restored' }); }} />
      <ConfirmDialog
        open={confirm === 'import'}
        onOpenChange={(o) => { if (!o) { setConfirm(null); setPendingImport(null); } }}
        title="Replace current data with this backup?"
        description="Everything currently in Align will be replaced by the backup file's contents."
        confirmLabel="Import and replace"
        destructive
        onConfirm={() => {
          try {
            if (pendingImport) importJson(pendingImport);
            toast({ title: 'Backup imported' });
          } catch (err) {
            toast({ title: 'Import failed', description: err instanceof Error ? err.message : 'Invalid file', variant: 'destructive' });
          }
          setPendingImport(null);
        }}
      />
      <Onboarding open={onboarding} onOpenChange={setOnboarding} hasDemo={hasDemo} defaultName={state.settings.name} />
    </div>
  );
}

function Row({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{body}</div>
      </div>
      {action}
    </div>
  );
}

type DraftGoal = { title: string; outcome: string; area: Area; targetDate: string; metricName: string; metricTarget: string; metricUnit: string };
const emptyGoal = (area: Area): DraftGoal => ({ title: '', outcome: '', area, targetDate: addDaysIso(todayIso(), 90), metricName: '', metricTarget: '', metricUnit: '' });

function Onboarding({ open, onOpenChange, hasDemo, defaultName }: { open: boolean; onOpenChange: (o: boolean) => void; hasDemo: boolean; defaultName: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(defaultName);
  const [goals, setGoals] = useState<DraftGoal[]>([emptyGoal('business')]);
  const [removeSample, setRemoveSample] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) { setStep(0); setName(defaultName); setGoals([emptyGoal('business')]); setRemoveSample(false); }
  }
  const filled = goals.filter((g) => g.title.trim());
  const finish = () => {
    const inputs: GoalInput[] = filled.map((g) => ({
      title: g.title,
      outcome: g.outcome,
      area: g.area,
      priority: 'high',
      targetDate: g.targetDate,
      metric: g.metricName.trim() && g.metricTarget && !Number.isNaN(Number(g.metricTarget))
        ? { name: g.metricName.trim(), unit: g.metricUnit.trim(), baseline: 0, target: Number(g.metricTarget), kind: 'outcome' }
        : undefined,
    }));
    startFresh(name, inputs, removeSample);
    onOpenChange(false);
    toast({ title: 'Your workspace is ready', description: `${inputs.length} goal${inputs.length === 1 ? '' : 's'} added${removeSample ? ', sample data removed' : ''}.` });
    navigate('/overview');
  };

  const titles = ['Welcome to a fresh start', 'Up to three goals', 'Sample data'];
  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title={titles[step]}
        description={step === 0 ? 'A few seconds of setup. You can change everything later.' : step === 1 ? 'Fewer goals, done properly. Leave extra rows empty.' : 'Keep the sample alongside your goals for reference, or remove it now.'}
        submitLabel={step < 2 ? 'Continue' : 'Finish'}
        canSubmit={step === 0 ? !!name.trim() : step === 1 ? filled.length > 0 : true}
        wide
        onSubmit={() => {
          if (step < 2) setStep(step + 1);
          else if (removeSample) setConfirmRemove(true);
          else finish();
        }}
      >
        {step === 0 && (
          <Field label="What should Align call you?" htmlFor="ob-name"><Input id="ob-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="input-onboarding-name" /></Field>
        )}
        {step === 1 && (
          <div className="space-y-4">
            {goals.map((g, i) => (
              <div key={i} className="rounded-xl border border-border p-4">
                <div className="eyebrow mb-3">Goal {i + 1}</div>
                <div className="space-y-3">
                  <Input autoFocus={i === 0} placeholder="Goal, e.g. Reach $5,000 monthly revenue" value={g.title} onChange={(e) => setGoals((gs) => gs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} data-testid={`input-onboarding-goal-${i}`} />
                  <Textarea rows={2} placeholder="Desired outcome" value={g.outcome} onChange={(e) => setGoals((gs) => gs.map((x, j) => (j === i ? { ...x, outcome: e.target.value } : x)))} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <AreaSelect value={g.area} onChange={(a) => setGoals((gs) => gs.map((x, j) => (j === i ? { ...x, area: a } : x)))} />
                    <Input type="date" aria-label="Target date" value={g.targetDate} onChange={(e) => setGoals((gs) => gs.map((x, j) => (j === i ? { ...x, targetDate: e.target.value } : x)))} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input placeholder="Result metric (optional)" value={g.metricName} onChange={(e) => setGoals((gs) => gs.map((x, j) => (j === i ? { ...x, metricName: e.target.value } : x)))} />
                    <Input placeholder="Unit" value={g.metricUnit} onChange={(e) => setGoals((gs) => gs.map((x, j) => (j === i ? { ...x, metricUnit: e.target.value } : x)))} />
                    <Input type="number" step="any" placeholder="Target" value={g.metricTarget} onChange={(e) => setGoals((gs) => gs.map((x, j) => (j === i ? { ...x, metricTarget: e.target.value } : x)))} />
                  </div>
                </div>
              </div>
            ))}
            {goals.length < 3 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setGoals((gs) => [...gs, emptyGoal(gs.length === 1 ? 'fitness' : 'english')])} data-testid="button-onboarding-add-goal">+ Add another goal ({goals.length}/3)</Button>
            )}
          </div>
        )}
        {step === 2 && (
          <div role="radiogroup" className="space-y-2">
            {[
              { v: false, t: 'Keep sample data', d: 'Sample items stay, clearly marked “Sample”. Remove them any time from Settings.' },
              { v: true, t: 'Remove sample data', d: 'Only sample items are deleted. You will be asked to confirm.' },
            ].map((o) => (
              <button key={String(o.v)} type="button" role="radio" aria-checked={removeSample === o.v} disabled={o.v && !hasDemo} onClick={() => setRemoveSample(o.v)} className={cn('w-full rounded-xl border p-4 text-left disabled:opacity-50', removeSample === o.v ? 'border-primary bg-accent/50' : 'border-border')} data-testid={`button-onboarding-${o.v ? 'remove' : 'keep'}`}>
                <div className="font-medium">{o.t}</div>
                <div className="text-xs text-muted-foreground">{o.d}</div>
              </button>
            ))}
          </div>
        )}
      </FormDialog>
      <ConfirmDialog open={confirmRemove} onOpenChange={setConfirmRemove} title="Remove sample data and start fresh?" description="All items marked Sample will be permanently deleted. Your new goals will be created." confirmLabel="Remove sample and finish" destructive onConfirm={finish} />
    </>
  );
}
