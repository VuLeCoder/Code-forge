# Frontend test alignment — 2026-11-22

The user requested that existing tests follow the approved repository redesign.

- The November 19 request explicitly deferred mobile changes and prioritized laptops. The file-viewer navigation test and the light/dark file-viewer overflow assertions now run at 1366 × 768 instead of 375 × 812. This is an intentional scope change, not evidence that mobile overflow is fixed. Other existing mobile tests remain unchanged.
- File navigation uses the visible source breadcrumb instead of the parent link hidden by commit `762fa65`. Directory return, browser Back, reload, branch retention, safe source rendering, line numbers, and proxy validation remain covered. Changing branches must preserve the open file, as requested on November 19.
- The loading assertion identifies the file-loading status specifically because the sidebar has its own status.
- Admin filters target the visible custom combobox inside the status label; selected values and filtered user rows remain asserted. The Repository tab uses an exact name to distinguish it from global search.

No application source or CI gates are changed. The admin control's accessible-name association remains a separate source accessibility concern; locating its visible label in this test does not certify that association.

Local verification: frontend lint, typecheck, and the production build used by Playwright passed. The final full frontend Playwright run passed 82/82 tests (1.5 minutes). An earlier focused run had a transient clone-dialog opening failure; the unchanged clone test passed in the full run, so this does not establish that the intermittent failure is resolved. CI and cloud verification were not run.
