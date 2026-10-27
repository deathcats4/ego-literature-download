# Download collection and content assignment

Use for user-requested parallel downloads, a loaded viewer, or missing download events. Browser operations remain ego-only. These helpers are modules, not a publisher search service or automatic login system. Read the current ego guide and observe each page before supplying callbacks or selectors.

## Shared pool for independent workers

Use `scripts/shared_download_pool.mjs` for requested multi-agent downloads. Resolve its installed file URL using [portable paths](path-portability.md). Workers own their article Pages throughout preparation and triggering; the coordinator owns only a dedicated `chrome://downloads/` Page and the shared session. Completed browser records provide provenance; PDF content determines article identity. No article download events, SDK download objects or trigger ownership are required.

1. Open the downloads Page and call `startDownloadPool({recordsPage, outputDir, browserVersion, workers, allowedOrigins})`. `outputDir` must be a **new absolute directory**; `workers` are unique IDs. Supply explicit HTTPS origins already observed in publisher PDF routes, including any observed download host. Before workers start, the helper freezes a baseline of old record IDs and the start time, and acquires the default global capture lease. A busy result grants no authorization. Publish the returned absolute `session_path` only after setup succeeds.
2. Run one observer CLI with `collectDownloadPool({sessionPath, recordsPage})`. Workers may begin once the session is published; the frozen baseline does not depend on which CLI starts first. The observer uses only its downloads Page. Keep one active CLI per TaskSpace, and one observer per session.
3. Each worker inspects its current article and PDF control, then invokes `triggerPoolDownload({sessionPath, workerId, attemptId, paperKey, trigger})` **inside its own ego round**. `trigger` clicks the observed control through that worker's Page. Use unique portable IDs (letters, digits, `_`, `-`, maximum 80 characters). Each action is registered before dispatch. Every PDF action, including opening a PDF menu/viewer, uses this helper. Workers join the session lease instead of competing for the whole capture lock, and may start the next prepared paper while others download. Keep article metadata and action receipts in the worker's own run directory.
4. A worker callback may return before the file finishes; that is expected. It must not call SDK `waitForEvent('download')`, `download.path()` or `saveAs()`. A caught `trigger_error` may still have started a download: inspect the current Page and collected records before a targeted new attempt. Retain initial failures. Preserve uncollected viewers rather than replacing their Pages. A route requiring SDK saving remains queued until this pool is closed and its lease resolved.
5. After **all of that worker's CLI rounds have actually exited**, call `finishPoolWorker({sessionPath, workerId, cliExitConfirmed:true})` from local Node, outside ego. Workers may finish independently. The marker is an assertion backed by actual command results, not an OS process check performed by the helper. A returned callback, timeout or cancellation alone is insufficient. On user takeover or browser failure, stop the affected work and inform the coordinator; stop all browser actions if the session pauses.
6. The observer saves completed records immediately under neutral UUID names. It accumulates observed IDs across polls, so a disappearing DOM row is not treated as success. Same ID is copied once; different IDs sharing URL/size are all retained for later SHA/content deduplication. New records require session timing, an allowed origin, a current completed state, a positive final size and a stable actual source file. Unknown/removed/out-of-window records are reported separately. Identity-field or completed path/byte changes withdraw that ID's candidate while retaining its first evidence. If the original source is externally removed **after** a stable copy, retain that copy and its at-copy receipt snapshot, report the later removed observation separately, and still require hash/content/visual checks. An already stable local copy is not silently overwritten.
7. Once all workers have actual-exit markers, the observer waits a discovery grace period and resolves observed active records before ending. It never stops because the number of files equals the number requested. After the observer CLI really exits, call `finalizeDownloadPool({sessionPath, collectorCliExitConfirmed:true})` from local Node. This writes `result.json` with sealed candidate provenance. Run the whole-pool matcher and classify every candidate; release the retained global lease only after all CLI exits and classification. Finish each worker's TaskSpace after successful verification; preserve or hand off spaces still needing user action.

Observer options: `pollMs=500`, `discoveryGraceMs=5000`, `idleTimeoutMs=90000`, `maxWaitMs=null`. Per-record growth renews idle time; other completed records are saved independently. A completed file temporarily unreadable on disk is recopied within the idle budget, without another browser click. In the validated ego `0.6.1.13` page, raw state `5` is `interrupted`; raw state `2` is completed. Other states remain pending without inventing meanings. Full bytes without completed state never suffice.

`readDownloadRecords` reports `progress_source`: exact `received_bytes`, approximate `displayed_bytes`, approximate `percent`, `completed`, or `unavailable`. Unknown-length records may expose growth only in status text, such as `28.1 KB/s - 5.8 MB`. The adapter ignores rates and reads the first non-rate byte field; it never skips an unsupported received value to use the later total. Supported numeric text uses a decimal point and B/KB/KiB/MB/MiB/GB/GiB/TB/TiB; grouped or locale-specific numbers remain unavailable, with a valid whole percentage as fallback. Rounded text can stay unchanged during very slow transfers: choose a longer idle budget when justified by observed behavior. These values are telemetry, not final byte counts or completion proof.

Both collectors use `readDownloadHistory` to revisit rows outside the downloads page's virtual viewport. It scrolls the rendered list to the frozen baseline, also locating previously pending IDs for the shared observer, and restores the initial scroll position. The bounded default is 64 scrolls with 75 ms settling per step; missing required rows, unsupported structure or exhausted scan budget stop observation. It neither reads private history databases nor proves discovery of every browser record. Keep this dedicated downloads Page free of manual search/filter changes while observing.

`pool_collected` means observation ended, **not** that all requested papers were obtained. A pool with zero files can end; the matcher must still report missing papers. `partial_pool` preserves valid candidates alongside rejected/quarantined records. Observation failure stops new dispatch and retains the lease. The coordinator owns `control.json`; set its state to `paused` atomically to pause. The observer checks it before the next browser read and again when closing, including after a last empty read. It never overwrites that file. Its separate `closed.json` fences new triggers as soon as it exists, then records `sealed` or `paused`; `control.json=accepting` alone does not mean an ended session can accept work. Pausing cannot cancel an already dispatched operation. Inspect actual worker/observer CLI exit before recovery. An incomplete registered action or abandoned session requires explicit diagnosis; there is no stale-lock expiry, automatic observer restart, automatic retry click, or general task scheduler.

Candidates carry `shared_pool_ui_completed`, no guessed `trigger_key`, and the same strict record audit used below, plus `audit.pool_id == audit.source_attempt`. `cli_exit_confirmed` stays false until finalization. The matcher rejects unsealed candidates. These are trusted local observations/exit assertions, not cryptographic attestation; keep session, attempts, exit records and checkpoints locally. PDF parsing, whole-pool identity matching and SHA-bound first-page inspection remain required.

This adapter is validated on ego `0.6.1.13` with the observed downloads-page structure and one real PeerJ shared-pool capture. It polls rendered rows; it cannot prove discovery of a record never exposed in that DOM, or one appearing after the grace period. Control simultaneous manual downloads and other tools sharing the profile. Use recorded new IDs for bounded recovery rather than scanning a guessed download directory. Upgrade or larger bursts require renewed browser validation. No browser download-directory setting is changed.

## Native parallel intake

Import `scripts/collect_downloads.mjs` from the resolved skill root using `pathToFileURL()`, as described in [portable paths](path-portability.md). `collectDownloads` acquires the default shared lease itself; do not double-wrap it. Inputs:

| Input | Meaning |
| --- | --- |
| `items` | `{key, doi, publisher, page, prepare?, trigger, inspect?}` per observed article |
| `recordsPage` | A Page already opened to `chrome://downloads/` in the same space |
| `outputDir` | New absolute attempt directory; no machine-specific default |
| `browserVersion` | Currently only `0.6.1.13`; other versions fail before browser actions |
| `startTimeoutMs` | Initial download response budget; default 30000 |
| `idleTimeoutMs` | Time without new bytes per paper; default 90000 |
| `maxWaitMs` | Optional explicit diagnostic ceiling; default null |

`prepare()` returns `{state:'ready'}` after article identity/access and a visible control have been checked. It can instead return `access_unavailable`, `human_verification_required`, `viewer_requires_save`, `consent_required` or `page_not_ready`. Preparation failures leave independent papers running. `trigger()` clicks the observed PDF control through its Page, without SDK `waitForEvent('download')`, `path()` or `saveAs()`. The collector polls events while triggering other papers and persists each completed file before slower papers finish.

`inspect()` optionally checks the current page when no download begins and returns one of the above states from visible evidence. Callbacks must return after a documented bounded operation: helper timers cannot terminate a stuck browser API call. Stop on loss of browser control. Authentication and consent are observed page actions; the helper does not click arbitrary dialogs.

Only IDs of old download records form the baseline. New records require matching frame-owned native events, completion, origin/path, start time and final bytes. Candidates use neutral UUID names. Unknown extra records or failures keep the batch partial. Ambiguous associations are retained separately; if later telemetry makes an already persisted association ambiguous, its file moves to `unresolved_candidates` and is withdrawn from the usable pool. A final observation runs after all triggering callbacks return.

PLOS has a separate fallback: a completed new record from `https://journals.plos.org/plosone/article/file`, with exactly one requested DOI in its `id` query and a start time within the attempt. Its GUID is null and its evidence is `completed_ui_ephemeral_plos_tab`. UI progress growth from the adapter above also extends its idle wait. Completion still requires a completed record and a stable file of the final size. This fallback does not accept unknown publishers, old records, or a canceled/ambiguous native transfer.

`collection.json` checkpoints each saved candidate; `result.json` includes the retained lease. A saved candidate is not an identified paper. The browser adapter depends on Chromium internals observed for this ego version, not a stable public API. `baselineIds` and `readRecords` are IO injection points for recorded-data tests, not a substitute for browser evidence in a live run.

After actual CLI exit, classify candidates and release the recorded lease from the coordinator. Preserve unresolved transfers and failed attempts; a returned result does not establish operation exit. See the [shared capture lifecycle](parallel-workflow.md#serialize-capture-globally).

### Audit completed records when events are missing

The automatic native collector does not implement a general UI-only fallback. In the multi-agent trial, completed files sometimes had no native start/completion events; `Page.enable` alone did not repair that telemetry. Inspect the original attempt's `unattributed_record_ids` after its CLI exits, rather than immediately repeating every download. A record still receiving bytes or interrupted is not a completed candidate. A browser-completed file may also be corrupt: preserve it and reject it if PDF parsing fails.

For a separately audited recovery, collect only those recorded new IDs through the current ego downloads UI, obtain the actual source path and positive final byte count, and use `persistCandidate` for a stable neutral copy. Label it `audited_batch_ui_completed`, leave `event_guid=null` and omit unknown trigger ownership. Retain the source attempt and its failures. Do not scan a guessed Downloads directory or infer identity from names/order.

The matcher accepts this label only with the following trusted audit facts; supplying a label alone remains `provenance_pending`:

| Candidate/audit field | Required evidence |
| --- | --- |
| `source_path`, `receipt_id` | Actual source path and current UI record ID |
| `audit.source_attempt` | Nonempty identifier locating the recorded triggering attempt |
| `audit.new_record_ids` | That attempt's newly observed record IDs, excluding its baseline |
| `audit.attempt_started_ms`, `audit.attempt_ended_ms` | Recorded attempt interval in epoch milliseconds |
| `audit.cli_exit_confirmed` | Coordinator confirmed actual owning CLI exit, then set true |
| `audit.record` | Observed `{id,file_path,state,removed,started_ms,total_bytes}`; completed, not removed, same path/ID/bytes and started within the interval (2-second UI precision tolerance) |

Audit fields are coordinator assertions backed by browser/run evidence, not proof independently obtained by the matcher. Keep that evidence locally. The hash, whole-pool identity match and bound first-page review remain mandatory; this adds neither automatic event recovery nor a new publisher download route.

## Loaded viewer and progress-aware SDK saving

Use `captureViewer(page, observedDownloadSelector, absoluteCandidatePath, options)` from `scripts/capture_viewer.mjs` for one loaded viewer. It acquires the lock, drains old events, arms the wait before clicking, saves in the same round and observes native byte progress. Only a successful save receives `serialized_sdk_saveAs`; failures keep their failure status. It does not decide that a viewer is readable, verify identity, release the lease, or finish the space. Concurrent SDK viewer captures remain unsupported. A link opening another Page needs its observed popup/target workflow; this helper does not redirect an original-page wait to a different tab.

For an artifact manually obtained inside an existing lease, `saveDownload` accepts `idleTimeoutMs` (default 90000), `pollMs` (default 250), and optional `observeProgress()` returning `{receivedBytes,totalBytes,state}` from current events. Output-file growth is observed independently of browser progress. A separate watchdog enforces idle and optional total budgets even if an observation call hangs; it cannot abort that pending call or prove CLI exit. There is no fixed total deadline by default; an explicit `timeoutMs` retains the absolute diagnostic limit when intentionally requested.

| Outcome | Meaning |
| --- | --- |
| `no_download_started` | Initial wait ended; inspect consent, viewer and access controls |
| `download_stalled` / `save_idle_timeout` | Bytes stopped growing; inspect after CLI exit |
| `save_confirmation_unresolved` / `save_finalization_timeout` | Bytes arrived but no final save; inspect Save As or a finalization failure |
| `viewer_requires_save` | Article opened a viewer; save individually after resolving the intake lease |
| `download_canceled` | Browser explicitly reported cancellation |
| `access_unavailable` | Visible article options still require authorization |
| `human_verification_required` | Verification remains unresolved after [normal ego handling](diagnostic-guide.md#handle-webpage-verification); hand off the same space |

An equal received/total count cannot prove a Save As dialog. Hand a confirmed native dialog to the user; use SDK viewer saving when applicable. See [viewer recovery](pdf-viewer-recovery.md). Cancellation failures and late writes retain their existing failure semantics; this does not repair ego's cancellation implementation.

A resolved save is not a complete file. In one retest `download.saveAs()` resolved without error for three transfers that held only 20%, 38% and 44% of the server's declared total; only a later size comparison exposed them, and the truncated files failed PDF parsing with a missing EOF marker. Read the server's own total from a short bounded range request (`Content-Range: bytes 0-1023/<total>`) before the download and pass it as `expectedBytes` to `saveDownload` (or to `captureViewer`, which forwards it): a saved size that differs from that total or from the browser's own reported total returns `capture_failed` with `failure_reason: 'save_size_mismatch'` plus `saved_bytes`/`expected_bytes`, even though `saveAs` resolved. Without either total the check cannot run, so supply one for any file large enough for a truncated transfer to look plausible. Budget the stage that actually moves bytes too: with the native viewer route the viewer's own load is the transfer (tens of seconds to minutes), while the viewer's Download control then saved from cache in 100-250 ms.

## Match the whole pool before delivery

Run locally with Python and `pypdf`, supplying absolute paths:

```text
python <resolved-skill-root>/scripts/assign_candidates.py <absolute-plan.json> --report <new-absolute-report.json> [--output-dir <absolute-assigned-directory>]
```

The JSON plan has:

```json
{
  "papers": [{"key": "paper-a", "doi": "10.1234/example", "title": "Expected article title"}],
  "candidates": [{"candidate_path": "<absolute PDF path>", "sha256": "<recorded hash>", "trigger_key": "paper-a", "completion_evidence": "native_event_and_ui"}],
  "visual_checks": [{"paper_key": "paper-a", "sha256": "<reviewed file hash>", "passed": true}]
}
```

Pass finalized shared-pool or current native-collector candidates unchanged. For a successful serialized SDK result, preserve `capture_status=saved_candidate`, `round_exit_required=false` and `completion_evidence=serialized_sdk_saveAs`; only after observing actual owning CLI exit, add `cli_exit_confirmed=true` locally before matching. Without all four fields it remains `provenance_pending`. This exit flag is a trusted assertion backed by command evidence, not a process check performed by the matcher. `round_exit_required=false` describes the helper result; it is not exit confirmation.

Preserve failure/exit fields when building the plan. Any explicit `capture_failed`, pending round exit, false exit confirmation or nonempty failure reason blocks that copy regardless of its evidence label or visual approval. A failed/late file remains unverified after exit; use a separate recovery attempt and path. An independently valid copy of the same hash can supply provenance without rewriting the failed copy's history. Evidence labels describe audited browser provenance; the matcher cannot independently prove it. `current_download_ui_completed` is reserved for a separately audited manual-save continuation. Missing-event batch recovery uses the stricter `audited_batch_ui_completed` record above.

Each distinct hash is parsed once and compared against every request using `verify_pdf.py` identity rules. Filenames, trigger ownership and arrival order never select identity. Identical copies collapse with their provenance; B+B cannot fill A+B. Different versions matching one paper, or one file matching several papers, remain ambiguous. Invalid sources and unmatched extras do not discard valid independent matches.

A first run without visual checks reports `visual_pending` for unique matches with recorded provenance. Render and inspect first pages, bind reviews to file SHA and paper key, then use a new plan/report. For repeated reviews of the same hash/key, the last record wins. Missing provenance gives `provenance_pending` even after visual approval. Only `verified` papers are copied with `--output-dir`; different existing bytes are never overwritten. Original candidates remain intact.

Exit 0 means every request is verified and there are no extras or invalid candidates. Exit 2 may mean a valid partial result; inspect its report and retain verified papers. Replaying historical files is neither a new browser download nor a new visual review.

## Navigation timeout with a usable page

`prepareArticle(page, url, {readySelector, timeoutMs})` attempts navigation and waits for an observed readiness selector, including after a load timeout. A usable page returns `state=ready, navigation_timed_out=true`; a missing selector returns `page_not_ready`. Other navigation errors stop preparation. Readiness alone does not verify article identity or access. Confirm the current DOI/title and controls before its trigger.
