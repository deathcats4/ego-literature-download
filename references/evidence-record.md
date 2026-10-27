# Local evidence record

Store UTF-8 JSON and artifacts in the user's output directory or this project's ignored `runtime/runs/<timestamp>_<name>/`, outside tracked source files. Use absolute local artifact paths. Do not store credentials, cookies, tokens, complete signed links, or personal SSO screenshots.

Required fields per paper:

| Field | Meaning |
| --- | --- |
| `requested` | DOI/title/article URL supplied or resolved before download |
| `observed` | Title and DOI on the actual article/document |
| `file_status` | `success`, `unverified`, or `missing`; definitions below |
| `standard_status` | Observed workflow outcome from [diagnosis](diagnostic-guide.md) |
| `result_evidence` | `browser_verified`, `http_preflight`, or `not_verified`; definitions below |
| `next_action` | Concrete next step, or null on completion |
| `status` | Optional legacy summary: `verified`, `downloaded_unverified`, or `blocked` |
| `browser` | `ego-lite`, runtime version if known, TaskSpace ID |
| `route` | Ordered portal/publisher/PDF-host steps; omit query strings |
| `access` | Institution recognized yes/no/unknown; OA yes/no/unknown; entitlement granted/denied/unknown |
| `session` | Existing profile/login reused; user-reported or observed network/VPN conditions and their evidence, with unknowns explicit; new browser/profile/login only if tested |
| `interventions` | Login/verification observations and actions, actor (`agent` or `user`), and outcome from [verification handling](diagnostic-guide.md#handle-webpage-verification); `[]` if none |
| `file` | Absolute path, bytes, SHA-256, page count, helper result; null if no candidate exists |
| `visual_check` | First-page title/readability result and evidence path |
| `error` | Displayed error and last successful step, or null |
| `recorded_at` | Timestamp with timezone |

For blocked or incomplete attempts, use null for unavailable observed identifiers, file metadata, or visual evidence rather than inventing values. Entitlement remains unknown when only institution recognition or an OA download was observed; record granted/denied only when the article's access state establishes that institutional entitlement.

## File outcome and evidence

- `file_status=success` requires all of: observed browser download, structurally readable PDF, established paper identity, and a visual first-page check. The helper's `identity_match` alone cannot set this status. A DOI found only in references is not identity proof; the helper limits matching to the first two pages, and the visual check remains necessary.
- `file_status=unverified` means a saved candidate exists but one or more acceptance checks are incomplete or failed. Preserve the helper result and rejection reason, including invalid files or explicit identity conflicts; this is not a usable-PDF claim.
- `file_status=missing` means no persistent candidate file was saved. An open viewer or temporary download path does not change that outcome.

`result_evidence` records how the observation was established, independently of success:

- `browser_verified`: the actual browser result was inspected and recorded, including a blocked attempt. A successful row additionally requires the download and checks above.
- `http_preflight`: only HTTP/API/route discovery evidence is available; it cannot establish this skill's final browser access/download result.
- `not_verified`: sufficient browser or HTTP evidence was not recorded.

InstSci's `oa_direct` and `publisher_open_pdf` describe retrieval paths this browser-focused skill does not implement. Do not silently substitute one for a failed ego route. Keep a separately authorized retrieval's provenance separate.

For example, a loaded viewer with no saved file has `file_status=missing`, `standard_status=capture_failed`, and `result_evidence=browser_verified` when the viewer state was inspected and recorded. A saved PDF with insufficient text and visual identity has `file_status=unverified` and `standard_status=identity_unresolved`.

Keep the helper's `identity_status`, `primary_dois`, and `doi_evidence` with the file result; interpret them using [diagnosis](diagnostic-guide.md). A matching title does not override a conflicting primary DOI. Preserve save-helper results separately: `saved_candidate` is not verification, and a failed save can leave a partial or later complete file. Its `candidate_exists` is an observation at return time, not proof that pending writes have stopped. Confirm the failed CLI round has exited, then record the post-exit candidate state separately. Retain `capture_failed` and an unverified late file even if text identity passes; record recovery to a new path as a separate attempt. Preserve `cancel_status` and the helper's safe `cancel_error_kind` when available, without copying raw SDK exceptions.

## Existing records

For new records, the three explicit fields are authoritative. If emitting the optional legacy `status`, map `success` to `verified`, `unverified` to `downloaded_unverified`, and `missing` to `blocked`. `blocked` is only a legacy summary and does not identify the cause.

Keep old manifests unchanged. When reading a legacy-only row, report its original status; populate new fields only from available evidence. In particular, `blocked` cannot distinguish authentication, access denial, and capture failure, and `verified` alone cannot prove a browser provenance field.

Include skill version/source commit in the run-level record when testing or reporting reproducibility. Preserve earlier records when a later attempt fails.

For a resumed assignment, retain the earlier challenge or capture failure in `prior_attempts` with its original evidence and status. Record the user's confirmed intervention and the new outcome separately. At run level, keep publisher entry attempts without a selected paper separate from per-paper results; a challenge before paper selection is not a failed DOI download.

## Continuation checkpoint

Before handing off for user action, save a `continuation` object in the local paper/run record: TaskSpace ID and name, known Page label, requested DOI/title, public article URL, last completed stage, required user action, and handoff timestamp. Persist whether handoff actually completed; a plan to hand off is not its receipt. Store authentication page titles/stages rather than SSO URLs, form values or screenshots containing credentials. If a capture round was involved, also retain its result/lease and whether that CLI has exited.

After user confirmation, record the new observation and any intervening missing-space result in `prior_attempts`. When replacement is authorized, preserve the old checkpoint and record the new space and authorization separately. Checkpoints locate work; they do not keep a TaskSpace alive or prove that authentication succeeded. Resume using [authentication continuation](diagnostic-guide.md#resume-after-user-authentication).
