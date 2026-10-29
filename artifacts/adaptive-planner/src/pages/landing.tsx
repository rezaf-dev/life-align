import { Link } from 'wouter';
import { ArrowRight, Lock, MessagesSquare, Target, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PublicBrand } from '@/components/auth/auth-chrome';

const WEEK = [
  { d: 'Mon', t: 'Draft pricing page copy', a: 'bg-[hsl(var(--primary))]' },
  { d: 'Tue', t: 'Intervals, 6 x 400m', a: 'bg-[hsl(158_30%_38%)]' },
  { d: 'Wed', t: 'Shadowing, 25 min', a: 'bg-[hsl(32_60%_48%)]' },
  { d: 'Thu', t: 'Call two churned customers', a: 'bg-[hsl(var(--primary))]' },
  { d: 'Sun', t: 'Weekly review', a: 'bg-foreground/50' },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-[100dvh] bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70rem_36rem_at_90%_-20%,hsl(var(--primary)/0.08),transparent_60%)]" />
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5 md:px-8">
        <PublicBrand />
        <nav className="flex items-center gap-1.5">
          <Button asChild variant="ghost" size="sm"><Link href="/sign-in" data-testid="link-sign-in">Sign in</Link></Button>
          <Button asChild size="sm"><Link href="/sign-up" data-testid="link-request-access">Request access</Link></Button>
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-5 md:px-8">
        <section className="grid gap-12 pb-20 pt-10 md:grid-cols-[1.15fr_1fr] md:items-center md:pt-20">
          <div className="rise">
            <div className="eyebrow mb-5">A private planning workspace</div>
            <h1 className="font-display text-[2.8rem] font-light leading-[1.02] tracking-tight md:text-[4.4rem]">
              Fewer goals.<br /><em className="text-primary">Done properly.</em>
            </h1>
            <p className="mt-6 max-w-md text-[1.05rem] text-muted-foreground">
              Align turns three things you care about into a week you can actually keep — goals, a day plan, an inbox and a Sunday review, in one quiet place.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg"><Link href="/sign-up" data-testid="button-hero-request">Request access <ArrowRight /></Link></Button>
              <Button asChild size="lg" variant="ghost"><Link href="/sign-in" data-testid="button-hero-sign-in">I already have an account</Link></Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Membership is approved by the owner. Your workspace opens after approval.</p>
          </div>

          <div className="rise relative" style={{ animationDelay: '120ms' }} aria-hidden>
            <div className="rotate-[1.2deg] rounded-2xl border border-card-border bg-card p-5 shadow-[0_30px_80px_-40px_hsl(var(--primary)/0.45)]">
              <div className="flex items-baseline justify-between border-b border-border pb-3">
                <span className="font-display text-xl italic">This week</span>
                <span className="font-num text-xs text-muted-foreground">wk 23 · 4 of 7 kept</span>
              </div>
              <ul className="mt-3 space-y-2.5">
                {WEEK.map((w, i) => (
                  <li key={w.d} className="flex items-center gap-3 text-sm">
                    <span className="w-8 font-num text-xs text-muted-foreground">{w.d}</span>
                    <span className={`size-2 rounded-full ${w.a}`} />
                    <span className={i < 2 ? 'text-muted-foreground line-through decoration-foreground/30' : ''}>{w.t}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 rounded-lg bg-muted/60 p-3">
                <div className="mb-1.5 flex justify-between text-xs"><span>Monthly revenue</span><span className="font-num">$3,140 / $5,000</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full w-[62.8%] rounded-full bg-primary" /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-[1.3fr_1fr_1fr]">
          {[
            { icon: Target, t: 'Goals with a pulse', b: 'Each goal carries a result metric and a pace line, so you notice drift in week two, not month three.' },
            { icon: MessagesSquare, t: 'Ask Align', b: 'Describe a messy week in a sentence. Align drafts the tasks; you approve every change.' },
            { icon: Lock, t: 'Yours alone', b: 'Every account is private. No shared boards, no teammates peeking in.' },
          ].map((f) => (
            <div key={f.t} className="bg-card p-6 md:p-7">
              <f.icon className="size-5 text-primary" strokeWidth={1.75} />
              <h2 className="mt-4 font-display text-xl">{f.t}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.b}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-8 py-20 md:grid-cols-[1fr_1.4fr] md:items-start">
          <h2 className="font-display text-3xl leading-tight md:text-[2.4rem]">How joining works</h2>
          <ol className="space-y-5">
            {[
              ['Create an account', 'Email or a social sign-in. It takes under a minute.'],
              ['The owner reviews it', 'Align stays small on purpose. Requests are approved by hand.'],
              ['Start with a blank page', 'Your workspace begins empty and private. Nothing from anyone else carries over.'],
            ].map(([t, b], i) => (
              <li key={t} className="flex gap-4">
                <span className="font-num mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-primary/30 text-xs text-primary">{i + 1}</span>
                <div><div className="font-medium">{t}</div><div className="text-sm text-muted-foreground">{b}</div></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mb-16 flex flex-col items-start justify-between gap-5 rounded-2xl bg-primary px-7 py-9 text-primary-foreground md:flex-row md:items-center md:px-10">
          <div>
            <div className="flex items-center gap-2 text-sm opacity-80"><UserCheck className="size-4" /> Invite-only</div>
            <div className="mt-2 font-display text-2xl md:text-3xl">Ask for a seat at the desk.</div>
          </div>
          <Button asChild size="lg" variant="secondary"><Link href="/sign-up" data-testid="button-cta-request">Request access</Link></Button>
        </section>
      </main>
      <footer className="relative z-10 mx-auto max-w-6xl border-t border-border px-5 py-6 text-xs text-muted-foreground md:px-8">Align · a personal planning workspace</footer>
    </div>
  );
}
