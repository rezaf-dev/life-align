---
name: AI approval boundaries
description: Rationale for keeping model suggestions separate from authoritative planning records
---

The model is not an autonomous writer or a persistence system. It must distinguish stored facts from suggested changes and must not claim changes succeeded before application approval completes.

**Why:** The AI-first brief explicitly makes safe approval critical while requiring existing planning data and manual workflows to remain intact. A fluent response is not evidence of a completed operation.

**How to apply:** Keep model calls outside the mutation transaction. Validate selected operations together, reject invalid dependencies without partial writes, and confirm actual changes only after browser persistence updates. If later adding server persistence or accounts, explicitly plan how to preserve local records and approval/retry guarantees rather than assuming the current AI API already stores them.
