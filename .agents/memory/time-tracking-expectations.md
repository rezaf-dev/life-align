---
name: Time tracking and client reporting
description: Optional timers, work-done capture, private report notes, and saved-timesheet expectations.
---

Some goals involve hourly work for clients. Timers must remain optional: users must be able to add time manually and edit recorded work, not only record through timers.

**Why:** The user explicitly requested manual addition and editing alongside time-tracking tools, and asked to plan for useful UX before implementation.

**How to apply:** Treat manual and timer-based tracking as alternative ways to create the same work record. Preserve corrections and timesheet compatibility when introducing timers.

Work-done details describe actual accomplishments without requiring a task for every small piece of work. Users need to capture them while the timer is active and keep them safely for later client reporting.

**Why:** The user asked to enter items during active work “so I don't forget them” and explicitly asked to keep them somewhere safe.

**How to apply:** Keep captured accomplishments with the account's timer/time records, separate from private notes. Recording descriptions must not add time or complete tasks; preserve them when reviewing and saving work.

Tasks with recorded time must automatically be part of the work-done summary; users should not have to re-enter their task names.

**Why:** The user explicitly requested automatic inclusion of tasks they spent time on, to avoid entering the same work again.

**How to apply:** Include timed tasks alongside optional additional descriptions, without claiming task completion or adding duplicate time. Preserve the difference between time spent on a task and finishing it.

Saved timesheets need editable internal report notes that never appear in client-facing output, plus manual paid/unpaid tracking.

**Why:** The user explicitly requested report notes “in panel, not visible to client” and wants to track customers' payments alongside saved timesheets.

**How to apply:** Keep report notes separate from client descriptions and opt-in session notes. A manually marked payment is a bookkeeping record, not confirmation from a payment provider.

Save client timesheets as historical copies rather than live views of current time logs.

**Why:** Time corrections or later work should not silently change a statement already sent to a client; editing a report must not rewrite actual work or goal progress.

**How to apply:** Keep saved reports independently editable and require explicit deletion of their payment history before deleting the associated goal.

Recording less than planned must not imply that the person finished their intended work. Ask whether to continue later, finish the session, or replan the remaining time.

**Why:** The user reported that a 30-minute log against a one-hour session misleadingly appeared done, and approved these three choices for both manual logging and timers.

**How to apply:** Credit actual time only. Keep unfinished time as a linked, nonrecurring plan so it remains actionable without duplicating time or the next regular occurrence. Later corrections change historical actual work, not the separate remaining plan; say so in the correction UI. Done/recorded states should look calm and successful, not error-red.

Time invested is optional, app-wide information separate from goal results. Goals do not need an hours measure to show invested time, and general work must not require inventing a goal.

**Why:** The user approved global daily/weekly/monthly/custom reporting while agreeing that results remain more important than hours. Time measures are explicit targets, not a prerequisite for tracking.

**How to apply:** Count actual work records once; task allocations and goal-measure credits are views of the same work, not additional time. Keep task completion and result entry usable without a timer. Report accomplishments alongside effort without deriving a productivity score from hours.

Time-of-day reports must distinguish known clock intervals from duration-only or historically unspecified work. Missing time is not evidence of distraction or wasted time.

**Why:** The approved first version uses real working intervals and explicitly avoids guessing when work happened or judging untracked time.

**How to apply:** Retain local timezone and genuine timer/manual-clock intervals. If reviewed duration or date no longer matches an interval, keep the corrected actual duration but leave its clock position unspecified. Do not infer positions from creation timestamps.
