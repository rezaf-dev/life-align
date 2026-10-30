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
