# Parallel publisher work

Read before running a user-requested parallel batch. Concurrent SDK capture produced a wrong-document candidate and stalled saves; the internal cause remains unconfirmed. Routine SDK captures remain serialized. For requested multi-agent downloads, use the [shared record pool](batch-download-tools.md#shared-pool-for-independent-workers): workers prepare and trigger their own papers while one observer persists browser-completed records under a session-wide lease. Article ownership is determined later by the global content matcher. This bypasses concurrent SDK saves without claiming to repair their internals.

## Assign ownership

Before dispatch, prepare one paper list with unique keys, DOI/title, and the known journal, publisher, hosting platform, article URL and access route. Record where each source fact came from and whether it is confirmed, provisional or unknown. Use supplied links, available citation metadata and observed DOI landing pages; a DOI prefix is only a clue, not proof of the current host. A journal's publisher, article platform, PDF host and institutional WebVPN address can differ.

Group work mainly by confirmed hosting platform and working access route, then balance paper counts and observed workload. Do not wait for every PDF page to load merely to plan groups. Give unknown sources a discovery owner; update the list and transfer ownership explicitly if the actual platform differs, before another worker triggers that paper. Each paper has one active owner. A small planning row can be:

```text
key | DOI/title | journal | publisher | platform | article URL | route | source evidence/status | owner
```

Publisher grouping schedules work; it does not identify downloaded files or prove subscription access. Workers still confirm the current article and entitlement. Shared-pool `allowedOrigins` must come from actually observed PDF routes, not a DOI prefix or guessed publisher domains. If a required host is unknown, discover it before admitting that download; a newly observed host outside a frozen session needs a later session after resolving the current lease. Final assignment remains by PDF content.

Use a stable TaskSpace per independent publisher assignment when the user has authorized parallel work. Assign one owner and allow only one active CLI round per space. Reuse its ID and Page labels across rounds; keep its files and manifest in a separate output subdirectory. Multiple spaces share the existing profile, so this is neither login isolation nor evidence of fresh authentication.

Keep source edits and aggregate reporting with the coordinator. Workers can independently search, inspect article identity/access, and navigate article pages. An authentication or verification stop affects that assignment; other publishers may continue. Apply the ordinary stop and handoff rules from `SKILL.md`.

In a shared-pool session, workers also click their own observed PDF controls through `triggerPoolDownload`; no prepared-page transfer or wait for coordinator clicking is required. They use the coordinator-published session lease, not per-worker locks. Each worker records its actual CLI exits before declaring its dispatch work finished. The observer never operates worker Pages. The next section applies only when deliberately using the older single-coordinator collection method or handing a specific Page over for diagnosis.

### Transfer prepared pages between agents

Workers return a durable batch containing a globally unique paper key, DOI, title, article URL, TaskSpace ID, Page label, readiness state, and the current observed PDF selector/href. Include full metadata for queued papers too. Before the coordinator operates those Pages, the worker confirms its last CLI actually exited and stops browser actions in that space. This internal ownership transfer does not use `handOff()`, which is for the user. The coordinator explicitly returns the space before a worker resumes.

Reuse only Pages whose files are durably collected, or whose pending work has been explicitly moved and recorded. A clicked article may have opened an uncollected viewer. Inspect action receipts and managed tabs before replacing it. Every PDF-control click, including one expected only to open a viewer, requires the shared lease. Local rendering and PDF review can overlap another space's capture.

Separate preparation time, overlapping transfer evidence, collection/recovery time, and final verification. The 24-paper multi-agent trial established overlapping preparation, but used aggregate collection rounds and serial recovery rather than a continuous pipeline. Resumed Pages often had missing native download events even when the browser completed files; explicit `Page.enable` did not resolve this. An empty event buffer is not proof of no download. Inspect this attempt's new UI records before retrying; use only the audited recovery described in [download tools](batch-download-tools.md). Preserve initial failures separately from recovered results. No same-input single-agent timing comparison has established a speedup.

## Serialize capture globally

This section governs SDK capture and the older `collectDownloads` batch. A shared-pool session acquires the same global lock once, and explicitly admits registered workers through its helper; workers do not acquire separate leases. Unrelated captures remain blocked until the pool is finalized, classified and explicitly released.

The coordinator queues papers and every worker uses [capture_lock.mjs](../scripts/capture_lock.mjs). Its atomic filesystem lock blocks cooperating processes before they arm a download wait or click a PDF control. Use its default path, `runtime/download-capture.lock` under this skill, across all runs and TaskSpaces. A separate lock per worker/run defeats this protection. Other skills, manual downloads and callers bypassing this helper are outside its scope; coordinate them too. This is a skill-level mitigation, not an ego SDK fix or a scheduler.

1. Wrap the whole capture operation in `withDownloadCapture(operation)`, before creating its event wait. `capture_status=capture_busy` means the callback did not run: end that round and leave the paper queued. The helper does not automatically retry. Other workers may inspect ordinary article pages while the turn is held.
2. The granted worker arms the appropriate event, clicks the visible control, and saves the download to its own absolute path in the same CLI round. A viewer requires its actual download control; an article PDF click may navigate without producing a download.
3. The helper retains the lock even after a successful callback. Confirm that CLI has exited, then check the persisted PDF against that worker's expected DOI/title, or reuse the check made inside its callback. Only after both conditions pass may the coordinator call `releaseDownloadCapture({lockPath: result.capture_lock.path, leaseId: result.capture_lock.lease_id})` from its local Node process. A suggested filename is not identity evidence. Complete the first-page visual check before reporting success; local rendering may overlap another worker's capture.
4. On a wrong-document candidate, preserve it as `unverified` / `pdf_candidate_conflict`, pause new captures, and notify the coordinator. Check other in-flight artifacts before a targeted same-space serial recovery. Never overwrite the rejected evidence or accept it under the expected filename.
5. On a stalled capture, follow the [bounded save procedure](pdf-viewer-recovery.md#bound-the-save-and-confirm-round-exit). Record the round and whether a file exists. Request cancellation, end only the affected CLI round, and confirm that identified CLI process has exited. Resolve any candidate as unverified/rejected before explicit owner-matched release. A timeout or completed cancellation request alone does not release the turn. Preserve the browser space; inspect it before a targeted retry.

Import the helper in the ego round from this skill's installed absolute file URL. Supply the capture callback using the current ego guide; it must contain the event wait, triggering action, same-round save and bounded error handling described in viewer recovery. Return the save result, plus `identity_match` / `identity_status` if local verification ran inside the callback. `capture_lock.identity_verified` records those returned fields, not an independent file check. A thrown callback returns `capture_failed` with a retained lease and omits raw errors that could contain signed links.

Release runs outside the owning ego round after its actual CLI exit. Keep the result/lease in the run record; do not rely on the PID reported inside an ego script. Partial or abandoned lock files stay blocking: there is no age-based expiry or automatic stale-lock deletion. If no valid lease record exists, identify the owning round and confirm exit before the coordinator removes that one known lock file. Never remove a lock merely because another paper is waiting.

Record both the failed attempt and the later outcome. Serial recovery succeeded in the original spaces during testing, but this does not establish the precise cause of the concurrent failure or a guaranteed workaround for all errors.

## Diagnose a cross-space candidate only when requested

A user-authorized two-paper comparison on ego lite 0.6.1.11 / guide v2.1.0 reproduced the mismatch after serial baselines passed. The MDPI event's suggested filename, URL path, GUID and frame matched its article, but `download.path()` pointed to the Frontiers PDF, and `saveAs()` persisted identical Frontiers bytes before the MDPI file completed. Both correct PDFs ultimately appeared in one temporary directory. This narrows the fault to metadata-to-file association; shared directory configuration and temporary-file selection remain hypotheses, not a confirmed SDK implementation or fix. Normal downloads still serialize capture.

For an explicitly requested diagnostic comparison, first establish each paper's serial result, then use dedicated spaces, distinct absolute output paths and one active CLI round per space. Stop on the first wrong identity; keep existing files and end the affected exact CLI round before further browser work. Do not turn a diagnostic exception into routine simultaneous capture.

Record the event's suggested name and safe URL host/path, save timing, same-round `download.path()`, final file hash/identity, and download GUID/frame/progress from the documented `page.events()` buffer when available. Collect only download fields, excluding signed queries and unrelated network data. Read the current ego guide before using these APIs. Buffers may be empty after round disposal; missing telemetry is not proof that no event occurred. An event name or matching filename cannot establish the saved file's identity.

If observed temporary files must be preserved, inspect only the recorded directory and known public PDF paths; keep snapshots as diagnostic evidence rather than successful `saveAs` results. Identify a stalled CLI by its actual OS command/process or tool session: a script's `process.pid` may refer to the execution host and is not sufficient for termination. Do not change browser download configuration to diagnose ordinary captures. Keep machine-specific timestamps, exact paths and reproduction input in the user's local run record.

## Resume and finish

After the user confirms completing a challenge, take over the same handed-off space and inspect its current page before continuing. `userPage()` may return no page; use an already recorded Page label, or inspect the managed tabs using the current ego guide. A cleared search challenge can be followed by a new challenge on the article or PDF page; record that new stage and apply [verification handling](diagnostic-guide.md#handle-webpage-verification) before deciding whether another handoff is needed. Article access and entitlement still need their own evidence.

Finish each successful assignment exactly once after its evidence is recorded. Keep assignments needing user action handed off. The aggregate report distinguishes verified PDFs, selected papers awaiting access, and publisher entry attempts where no paper was selected; do not collapse them into a download success rate.
