---
name: Responsive expanded states
description: Why mobile layout verification must include expanded result histories
---

Check responsive width with result histories and their action controls expanded, not only the initial page.

**Why:** A collapsed result view fit a phone while its expanded ledger widened the grid's intrinsic track and pushed neighboring controls outside the viewport. Narrowing individual controls did not constrain the parent track.

**How to apply:** For data grids containing long ledger rows, use explicit zero-minimum tracks and allow grid items to shrink. Verify the expanded state as well as the collapsed state; do not conceal layout defects by clipping the page or its controls.
