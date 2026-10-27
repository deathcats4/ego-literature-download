# Parallel article work

Use this reference when multiple workers or Pages are available. A DOI list is enough to begin: open each DOI, inspect its current page, and choose the next action from what is visible. Do not delay dispatch to classify publishers, hosts, access routes, or groups. Assign papers directly from the supplied list or balance them by count. Keep one active ego CLI round per TaskSpace.

Each worker reports progress as it happens: the DOI/Page just opened, the visible state, the action taken, the result, and what remains active or blocked. Continue independent papers when one needs credentials, user input, or further diagnosis. A visible, operable verification challenge can be attempted through documented ego APIs; after it clears, resume that same paper.

There is no global capture lock or cross-task capture queue. A loaded viewer's Download control should be triggered promptly. Independent Pages may use SDK captures concurrently. Earlier concurrent SDK captures produced a wrong-document candidate and stalled saves, with the internal cause unconfirmed; verify each saved PDF and match ambiguous files by content instead of delaying downloads. Preserve any conflicting candidate as unverified and inspect current browser records before recovery.

The optional [shared record pool](batch-download-tools.md#shared-pool-for-independent-workers) can collect native browser records when multiple workers need a neutral candidate directory. It starts without a publisher or host allowlist and accepts newly observed HTTPS records after the recorded baseline. Its per-session observer and worker completion markers keep its own files consistent; they do not block independent captures or other sessions. If the observer fails, stop dispatch through that pool, preserve its candidates, and continue work outside it when useful.

Use separate output folders and stable paper keys so each attempt remains traceable. When receipt-to-article ownership is uncertain, run the whole-pool content matcher; never assign by trigger order or suggested filename. Confirm CLI exit before finalizing provenance, then parse and identify every PDF. Use visual review for ambiguous or insufficient text evidence, scans, covers, or strict review. Keep initial failures and later recovery outcomes distinct. Prior trials showed overlapping preparation but did not establish a controlled speedup over one agent.

If a Page must move between workers, record its DOI, current Page label, last observed state, whether a download was triggered, and whether its candidate is durable. The current owner confirms its CLI round exited before another worker operates the Page. This is an internal ownership handoff; user handoff remains in the ego TaskSpace.

## Diagnose a cross-space candidate only when useful

A user-authorized two-paper comparison on ego lite 0.6.1.11 / guide v2.1.0 reproduced a mismatch after serial baselines passed. The MDPI event's suggested filename, URL path, GUID and frame matched its article, but `download.path()` pointed to the Frontiers PDF, and `saveAs()` persisted identical Frontiers bytes before the MDPI file completed. Both correct PDFs ultimately appeared in one temporary directory. This narrows the fault to metadata-to-file association; shared directory configuration and temporary-file selection remain hypotheses, not a confirmed SDK implementation or fix. Treat SDK output as a candidate and verify its contents.

For a diagnostic comparison, use dedicated spaces, distinct absolute output paths and one active CLI round per space. Stop on a wrong identity; keep existing files and end the affected exact CLI round before further browser work. Record safe URL host/path, save timing, final hash/identity, and available download GUID/frame/progress. Exclude signed queries and unrelated network data. Read the current ego guide before using these APIs. Missing event telemetry does not prove that no download occurred.

If temporary files must be preserved, inspect only the recorded directory and known public PDF paths; keep snapshots as diagnostic evidence rather than successful `saveAs` results. Identify a stalled CLI by its actual OS command/process or tool session: a script's `process.pid` may refer to the execution host and is not sufficient for termination. Do not change browser download configuration as a routine step.

## Resume and finish

After the user confirms completing a challenge, take over the same handed-off space and inspect its current page before continuing. `userPage()` may return no page; use an already recorded Page label, or inspect the managed tabs using the current ego guide. A cleared search challenge can be followed by a new challenge on the article or PDF page; record that new stage and apply [verification handling](diagnostic-guide.md#handle-webpage-verification) before deciding whether another handoff is needed. Article access and entitlement still need their own evidence.

Finish each successful assignment exactly once after its evidence is recorded. Keep assignments needing user action handed off. The aggregate report distinguishes verified PDFs, selected papers awaiting access, and publisher entry attempts where no paper was selected; do not collapse them into a download success rate.
