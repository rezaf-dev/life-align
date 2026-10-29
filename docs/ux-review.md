# Align: daily-usability review

Reviewed as a first-time user across Overview, Goals, goal details, Planner, Tasks & Inbox, Reviews, and Settings. Priorities reflect frequency, friction, and the risk of losing work—not visual novelty.

## Ranked findings

| Priority | Problem observed | Daily impact | Correction |
| --- | --- | --- | --- |
| 1 | Today's actions appear after a large greeting, reminders, and carried-over tasks. | The morning visit begins with backlog rather than a clear next action. | Lead with today's open tasks and quick capture; reduce the header and make reminders, overdue work, and completed items secondary. |
| 2 | Rescheduling is buried in each task's overflow menu. | A frequent daily action takes unnecessary discovery and clicks. | Expose one consistent scheduling control while preserving the full task menu and editor. |
| 3 | The weekly planner is seven tall vertically stacked cards, even for empty days. | Most of the week is off-screen; assessing balance requires excessive scrolling. | Compact the week layout and empty days; expose existing quick capture in each day. Preserve inbox scheduling and all seven days. |
| 4 | Planning controls truncate the focus and emphasize horizons, capacity, locks, and finalization. | The useful intent is hard to read and saving a personal plan feels administrative. | Wrap the focus, clarify available-time and save labels, provide save feedback, and preserve original commitment snapshots. |
| 5 | Goal details show a long strategy, all results, milestones, actions, and history together. | The next useful action is buried beneath strategic detail. | Give existing sections clear navigation and progressive disclosure; keep everyday actions readily reachable. |
| 6 | A weekly review takes seven screens; the first summary is long enough to hide navigation. | Reflection feels like a form-filling exercise, with repeated scrolling and navigation. | Group the existing five questions into Summary, Reflect, and Adjust phases with persistent navigation and concise actuals. |
| 7 | Leaving a review discards writing without warning; invalid changes can be silently excluded at save time. | Users can lose thoughtful work or believe an adjustment was applied when it was not. | Confirm discarding unsaved work, make approval explicit, reset approvals on proposal edits, and explain validation failures. |
| 8 | Labels such as “Executed,” “Leading indicators,” “Kept,” and unexplained pace markers require interpretation. | Users must learn the app's vocabulary before reading their own progress. | Prefer plain task/result language and make rule explanations available on demand. Keep activity and outcomes distinct. |
| 9 | Repeated sample badges, task metadata, and dense filter chips compete with task titles, especially on phones. | Lists become slower to scan and capture/filter controls consume too much space. | Simplify repeated metadata, retain sample identity, prioritize common filters, and preserve all secondary filters in compact controls. |
| 10 | Review history opens a dense full record by default; settings mixes everyday preferences, backups, and destructive resets. | Secondary information and risky actions compete with ordinary use. | Start history with a concise summary and expandable detail; separate workspace-reset controls from ordinary settings and backups. |

## Preservation requirements

- No new product modules, accounts, services, or data migrations.
- Do not clear, reseed, or replace existing browser data.
- Preserve recurring tasks, reminders, metric logs, strategy changes, milestones, goal status/splitting, import/export, original commitments, and review history.
- Keep destructive confirmations and explicit approval of review changes.
- Verify the revised review journey for lost-writing protection, approval behavior, persistence, and navigation.

## Verification

- The application typecheck passes.
- Visually inspected the updated dashboard, weekly planner, goal detail, and review summary, including phone layouts. Corrected an inbox-title squeeze and mobile planner overflow found during inspection.
- A browser check confirmed five reflections survive phase changes; canceling both sidebar-navigation and Exit discard prompts preserves the writing; editing an approved proposal clears approval; saving and reloading preserves the review, applied strategy, and goal history.
- The browser check did not exercise browser Back/Forward while dirty or independently save an unapproved proposal. Code inspection confirms only approved proposals are passed to the save action. Review drafts remain in memory, not persistent storage.
- Existing persistence format and stored data were left unchanged. No accounts, services, or product modules were introduced.
