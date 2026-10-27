# Diagnose a download attempt

Read when a paper fails, stalls, or yields an uncertain file. This adapts InstSci's diagnostic method to ego; it does not require InstSci commands or its browser runtime.

## Inspect before retrying

1. Pause actions on the affected paper and inspect it in its current TaskSpace. Note the last completed step, current page, displayed error, and whether a local file exists. Separate the article, login popup, and PDF viewer so a stale tab does not determine the result. For a wrong-document candidate during concurrent work, isolate that candidate and inspect its source; pause other work only if the observed issue could affect it too.
2. Use the current snapshot to identify the state; inspect a screenshot when the visible challenge, viewer, or error needs visual confirmation. For an apparent navigation timeout, inspect the resulting page before replaying the navigation.
3. Choose a status from the table below and write the corresponding `next_action`. Keep file outcome and evidence source separate using [evidence record](evidence-record.md).

| Observed condition | `standard_status` | Next action |
| --- | --- | --- |
| Browser download, file and identity checks passed; any triggered visual review passed | `success` | Deliver the verified PDF |
| Login or institution selection is needed | `auth_required` | Follow the visible institution route; hand off credentials to the user |
| OTP or a verification cannot be completed through the normal ego flow below | `human_verification_required` | Record the attempted action and result; hand off the same TaskSpace |
| Explicit journal/article subscription or entitlement denial | `access_unavailable` | Record the affected route; consider another available institution entry only within the stop rules |
| Explicit IP restriction/account lock, or access denial whose cause is unclear | `access_denied` | Preserve the exact message; stop on explicit restrictions or repeated denial |
| Security/WAF block or verification loop persists after verification handling | `waf_blocked` | Stop this publisher attempt and preserve evidence |
| Visible publisher content/server error | `publisher_error` | Record the error; retry later only when appropriate |
| Recorded TaskSpace no longer exists or its Page cannot be acquired | `browser_state_unavailable` | Check the current inventory and continuation record; keep authentication and entitlement unknown until inspected |
| PDF viewer loaded or download initiated, but no file was saved | `capture_failed` | Use [viewer recovery](pdf-viewer-recovery.md) |
| Save timed out or failed, including a candidate that appeared later | `capture_failed` | Confirm CLI exit, retain the failed attempt and late file, then inspect the original space using [viewer recovery](pdf-viewer-recovery.md) |
| Saved candidate is HTML, truncated, or not a parseable PDF | `pdf_invalid` | Retain the rejected candidate's diagnostics; inspect the actual browser result |
| Document's own title/DOI clearly identifies a different paper | `pdf_candidate_conflict` | Keep candidate unverified; resolve the discrepancy before acceptance |
| PDF parses but title/DOI text is absent or insufficient | `identity_unresolved` | Inspect the first page and compare title, authors, journal, year, and pages |
| Evidence does not distinguish the conditions above | `unresolved` | Record what is unknown and the specific observation needed next |

These labels describe this run. `access_unavailable`, `capture_failed`, and `waf_blocked` do not mean a publisher is generally unsupported. A bare HTTP 403 cannot identify an entitlement failure or WAF cause by itself.

## Bound recovery to the observed problem

A recoverable failure permits a targeted action in the same TaskSpace, such as using a current selector after navigation or arming a new viewer download wait. Observe the result before any further action; repeated failure without new evidence ends that recovery attempt. Stop conditions and user-control rules in `SKILL.md` take precedence over recovery or route alternatives.

After verification, inspect the current paper's actual state before resuming. Preserve who acted and any subsequent failure. Stop a repeating challenge rather than asking for the same action indefinitely.

If article, login, and PDF hosts behave differently, record only the observed host-level route and error. InstSci's process flags and route-doctor commands are not ego APIs; network changes are not a routine recovery step. Keep signed queries and private connector details out of shared records.

## Handle webpage verification

Use this branch for a visible security check or CAPTCHA, rather than treating its presence as proof that a human must act. Keep school login, OTP, consent controls, browser permissions and native Save As dialogs separate.

1. Inspect the current page and, when needed, the visible iframe subtree or screenshot through the installed ego guide. An automatic security check may clear without input: wait for an observable page transition within a bounded observation window (20 seconds by default), then inspect once. A timeout is an observation limit, not a download deadline or proof of denial.
2. If the site presents a verification control or challenge that the agent can understand and operate, work through its visible steps using documented Page selectors, mouse or keyboard APIs, observing the page after each action. Screenshot-based Page interaction is still ego-only; desktop automation remains excluded. Stop when the control is unreadable, requires user-only input, or repeats without observable progress. Do not invent a CAPTCHA API, inject clearance tokens or treat a dispatched click as verification success.
3. Continue only after the article or intended destination becomes accessible. Record the challenge kind, public host, TaskSpace/Page, attempted action, actor (`agent` or `user`) and observed outcome in `interventions`. Distinguish `not_present`, `cleared_without_input`, `agent_completed`, `user_completed` and `unresolved`. Reused clearance with no new challenge is not evidence that the agent solved one. Verification does not establish subscription access or PDF success.
4. On an unreadable/unsupported challenge, a failed submission, user-only input, or a loop without progress, preserve the checkpoint and hand off that space. Explicit restrictions and repeated denial still stop the publisher attempt. Retain the original failed observation when a later user action permits continuation.

## Resume after user authentication

Use the [continuation checkpoint](evidence-record.md#continuation-checkpoint) to locate the exact space and article. After the user confirms acting, resume that space through the current ego guide and inspect its current page. Authentication may have opened an unmanaged tab: inspect `task.tabs()` and adopt the relevant tab before operating it. Old Page handles, snapshot refs and execution variables are not durable checkpoints.

If the recorded space is missing, inspect `listTaskSpaces()` without operating unrelated spaces. Report `browser_state_unavailable`, not `auth_required` or `access_unavailable`; the inventory cannot establish why the space disappeared or whether the shared profile retained authentication. Follow the ego guide's authorization requirement before rebuilding a missing space or claiming a user-owned one. Give the known article/title as context instead of repeatedly asking the user to remember a space number.

When rebuilding is authorized, open the recorded public article URL in the existing profile. Inspect the article's current access state before starting a new login flow. A Springer test retained school-authorized access after the original space disappeared; this demonstrates one reused session, not guaranteed persistence after every restart. Record the new space, its relationship to the previous attempt and the user's authorization. Only follow institution login again if current evidence requires it.

An article-specific institution access statement, a previous subscription preview and current non-OA rights evidence can establish institutional access for that article. Preserve those observations and complete browser capture and identity checks; use visual review when identity evidence calls for it. Institution recognition alone, a personal login or an available OA PDF is insufficient. A new TaskSpace with retained authentication is not a fresh-login test.

## Resume an interrupted browser record

Use the current downloads Page rather than reopening the article blindly. Record the actual record ID, state, displayed error, total size and progress before acting. The UI's `resume` and `retry` controls differ; a field named `canResume` was absent in the tested browser. Inspect the rendered control instead of inferring capability from a missing field. A composite CSS selector can miss a button across nested shadow roots even when it exists; use a current snapshot ref or the documented Page DOM escape hatch for that exact rendered control.

Use one targeted Continue action, then observe that same record and any new records. Preserve the action time and before/after state. A dispatched click or a momentary receiving state is not a completed download. Percent values outside 0–100 are unavailable telemetry, not proof that the partial bytes were erased. Without observed Range/206 evidence or equivalent byte accounting, describe this as a continuation attempt, not verified byte-range resume.

An existing record retains its old ID and start time in some continuations. Do not remove it from the shared pool's baseline, alter its start time or label it a new current-batch record to pass acceptance. The current pool excludes these old records; a successful continuation needs an explicit before/action/after provenance review, stable copy and PDF identity. Preserve it as unverified until that evidence is accepted. No successful old-record continuation has yet been established in this project.

On repeated denial or an explicit Forbidden result, stop that publisher attempt. A UI error alone does not identify its server, browser or network root cause. Retain the failed attempt even if a later authorized attempt succeeds. Confirm the actual CLI exit and inspect pending transfers or late files before recovery.

## Separate path throughput from publisher refusal

A slow or aborted transfer is not a denial, and a denial is not a network fault. First inspect the current page, browser error and download record; make a targeted recovery when the evidence identifies one. Use the measurements below only after repeated interruptions, when throughput is the question being investigated, or when the user requests root-cause analysis.

1. Identify the observed symptom and what decision the measurement should inform.
2. When browser-path measurement is relevant, use a bounded byte-range read from the existing Page, record status, `Content-Range`, first-byte time and throughput, and discard the bytes. A probe is not a download candidate or identity evidence.
3. Add a same-machine control only if it helps distinguish the specific suspected cause. Read the browser transport error when available; a failure in an unrelated diagnostic fetch does not establish that the actual download failed.
4. Do not change global proxy, VPN or DNS settings as part of diagnosis. Use the evidence to choose a practical wait or concurrency for the next attempt and report what the measurement established and what remains unknown.

## Interpret identity evidence

`verify_pdf.py` checks the first two pages without OCR. It preserves DOI punctuation and reports `primary_dois` plus per-occurrence `doi_evidence`. Standalone DOI labels/URLs and resolver URLs near page margins are primary candidates; inline citations and text after recognized reference headings are excluded from identity proof. These are conservative heuristics, not a complete article-metadata parser: unmarked references, unusual layouts, or a cover longer than one page can require manual review.

| `identity_status` | Helper decision and record |
| --- | --- |
| `matched` | Expected DOI or title matched, with no detected blocking DOI conflict; use visual review when triggered by the conditions above |
| `conflict` | Primary DOI candidates exist but none matches the supplied DOI; `identity_match=false`, retain `unverified` / `pdf_candidate_conflict` even if the title matches |
| `ambiguous` | Expected DOI and another primary DOI candidate coexist; `identity_match=null`, retain `unverified` / `identity_unresolved` pending review |
| `unresolved` | No sufficient expected identity match; retain `unverified` / `identity_unresolved` |

`doi_match: false` alone means no primary candidate matched the expected DOI; absence is not conflict. Without an expected DOI, the helper can use the title but cannot determine whether an observed DOI disagrees with the request. An externally observed identity conflict always prevents acceptance, regardless of helper output.

For old or scanned papers, use the rendered first page and bibliographic agreement to resolve identity. Preserve the helper output and record visual evidence when reviewed. If identity remains unclear, retain `file_status=unverified` and `standard_status=identity_unresolved`.

PeerJ figure/table DOIs such as `10.7717/peerj.21817/fig-1` identify article components. The helper excludes these exact child patterns from primary DOI candidates only when the parent article DOI is independently observed as primary in the same document; the occurrence remains in `doi_evidence` with `subresource_of`. A child DOI alone cannot prove article identity. Foreign parents and other publishers' suffixes retain their conflict/ambiguity behavior.
