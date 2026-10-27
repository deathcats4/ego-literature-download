# Recover a loaded PDF viewer

Read when a PDF is visible but no persistent local file was captured. This adapts InstSci's distinction between viewer access and file capture; use the installed ego guide for the actual API.

## Recover within the current TaskSpace

1. Resume the same TaskSpace and identify the actual viewer using current page labels. Use `task.tabs()` to locate an unmanaged popup and adopt it before operating. Preserve the active access session; a new space/profile is not a capture fix.
2. Confirm that a readable document has loaded. A toolbar or `.pdf` URL alone is insufficient. If the page instead shows login, a challenge, an error, or a different paper, return to [diagnosis](diagnostic-guide.md).
3. If the prior script ended, its download wait and temporary file are no longer reusable. After resolving its retained lease, use the [shared capture lock](parallel-workflow.md#serialize-capture-globally) in a new round. Only its granted callback may arm the viewer download event, invoke the visible Download control and save to an absolute path before the round ends.
4. Inspect the saved file using `verify_pdf.py` and visually compare its first page with the requested paper. Only then update the result using [evidence record](evidence-record.md).

Use current snapshot selectors for a semantic Download control. When the viewer lacks usable semantics, inspect its screenshot and use the current ego guide's mouse/keyboard APIs. If ego cannot inspect or operate the viewer, including a minimized-window capture error, record the limitation and hand off the same TaskSpace; follow the ego-only boundary in `SKILL.md`. InstSci's UIA helpers and CloakBrowser listener commands are not drop-in ego operations.

The required order is **acquire lock → arm wait → click Download → await event → saveAs → CLI exit and identity check → coordinator release**. Event wait through save stay in one script. Consult the current guide for signatures rather than copying an old listener or a signed PDF URL. Record only the safe output path and outcome; download URLs can contain short-lived tokens.

If capture still fails after the targeted attempt, inspect the current viewer and record `capture_failed` with the error and last successful step. Preserve any candidate file as unverified. Continue only when a new observation identifies a specific corrective action; do not repeatedly click Download or recreate the TaskSpace. Finish successfully only after capture and all checks pass, following the ego lifecycle rules.

## Distinguish loading, saving and completion

A viewer showing a progress indicator may still be loading the document. Wait for its usable Download control and inspect the current state; do not repeatedly click the article link. A toolbar, a complete byte count, or a download-begin event still does not prove a saved file.

An HTTP `200` with `application/pdf` also does not establish that the full body arrived or that the PDF parses. In the OUP test, a Silverchair response reached this stage while the reader remained on a progress bar; a separate browser download then ended in Network error without a candidate. Keep the reader-loading observation and the transfer failure separately. Do not classify this as a proven reader-only defect or subscription denial, and do not substitute a background HTTP fetch for a browser download claim.

In the native collection experiment, a Copernicus viewer's Download control opened a system Save As window. All bytes had arrived, but native progress remained `inProgress` and no completed downloads-page record appeared until the user selected Save. Classify this as waiting for user save confirmation, not a slow network or a completed download. The ego API did not expose that native window. Record the checkpoint and hand off the same TaskSpace under the ego-only boundary; after the user's confirmation, inspect current completion evidence and verify the file. Preserve the initial incomplete attempt and mark the manual action separately.

For three other Copernicus papers in the same campaign, the serialized SDK procedure above saved from the loaded viewer without further manual Save As interaction. Thus finish the parallel native intake first, confirm round exit and classify its candidates, then recover viewer-only papers individually under the shared lock. This is a tested fallback for those papers, not evidence that concurrent SDK saves are fixed. The SDK configures only the addressed Page's download handling; do not reproduce it by changing global download settings.

## Bound the save and confirm round exit

Use an explicit timeout for the download event, such as the current guide's `waitForEvent("download", {timeout: 30000})`. Attach a rejection handler immediately so a failed click cannot leave an unhandled wait. On a click/event failure, stop further page operations in that round; if an artifact arrives, request its cancellation with a bounded wait before ending the round. Inspect the actual page after confirmed round exit rather than replaying the click.

Prefer `captureViewer` from [capture_viewer.mjs](../scripts/capture_viewer.mjs) for a loaded viewer: it owns the lock, event wait, observed click and progress-aware save described in [download tools](batch-download-tools.md#loaded-viewer-and-progress-aware-sdk-saving). Do not double-wrap it. If an artifact was manually obtained inside an existing lease, use [save_download.mjs](../scripts/save_download.mjs) inside that same round. Resolve `skillRoot` using [portable paths](path-portability.md):

```javascript
// skillRoot is this machine's resolved installed skill directory; see portable paths.
const {join} = await import('node:path');
const {pathToFileURL} = await import('node:url');
const {saveDownload} = await import(
  pathToFileURL(join(skillRoot, 'scripts', 'save_download.mjs')).href
);
const result = await saveDownload(download, absoluteCandidatePath, {
  idleTimeoutMs: 90000,
  cancelTimeoutMs: 5000,
  // observeProgress: async () => ({receivedBytes, totalBytes, state}),
});
console.log(JSON.stringify(result));
// On capture_failed, end this round now; do not click, retry, or finish the TaskSpace.
```

The helper calls the documented `download.saveAs` and, on error or timeout, requests `download.cancel`. It returns `saved_candidate` or `capture_failed`, a safe candidate path, elapsed time, and cancellation outcome. Its watchdog runs independently of progress/file observations, so a hanging observation cannot disable the budget; the pending call still requires actual CLI exit. For successful SDK candidates, follow the [matcher exit fields](batch-download-tools.md#match-the-whole-pool-before-delivery) before delivery. On a rejected cancellation, `cancel_error_kind` provides a fixed clue: `unsupported`, `browser_cancel_error` (the exception mentions `Browser.cancelDownload`), or `unknown`. Completed or timed-out cancellation has a null kind; successful saves have no cancellation fields. These clues do not establish the SDK root cause. Raw SDK error text and URLs are omitted. The helper does not launch a browser, verify identity, manage the capture queue, or terminate the CLI process.

`Promise.race` bounds waiting but does not cancel the underlying operation. Even `cancel_status=completed` does not prove the CLI round exited. On `round_exit_required=true`, return immediately from the script and confirm the actual CLI exit through its tool session. A returned result or an in-round `process.pid` is insufficient; that PID can identify the host. If the CLI remains stalled, stop only that identified CLI round, then confirm its exit before releasing the capture turn, inspecting a possibly changing candidate, or retrying in the original space. Do not kill the browser, edit its state files, or treat a timer firing as successful cleanup.

Check the candidate again after confirmed exit: `candidate_exists=false` at return time does not mean it will remain absent. Preserve late or partial files as unverified and keep the failed capture result; use a new candidate path for the recovery attempt. Two controlled ego `0.6.1.11` tests with a **1 ms diagnostic budget** returned `save_timeout`, rejected cancellation and later complete files. The second exception mentioned `Browser.cancelDownload`; both CLIs subsequently exited naturally. This tests the timeout boundary, not a natural 45-second stall, and does not establish why the SDK rejected cancellation.
