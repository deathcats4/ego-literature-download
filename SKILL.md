---
name: ego-literature-download
description: Download academic paper PDFs through ego lite using the user's existing publisher or institutional login. Use for a DOI, title, article URL, or list of papers, including school WebVPN access, visible browser downloads, and PDF identity verification. Keep this workflow independent of InstSci and its browser profiles.
metadata:
  version: "0.5.11"
---

# Literature downloads through ego lite

Obtain the requested paper through a visible ego browser workflow, then verify the saved file. This skill uses ego-browser; it does not invoke InstSci, import its cookies, or modify its configuration.

Operate and recover the browser exclusively through the current `ego-browser` CLI/API. Do not use computer-use, desktop automation, or native window controls as a fallback, including to restore a minimized window. If ego cannot perform the required operation, record the limitation and hand off the same TaskSpace for the user to act. Local PDF parsing and rendering remain part of file verification.

## Start

1. Read the installed `ego-browser` skill and run `ego-browser skill`. Follow its current API and platform instructions; do not copy an old browser API example into a new task without checking it.
2. Establish the paper identifier and an absolute output directory in the current task's environment. Resolve the actual installed skill and ego CLI locations on this machine; follow [portable paths](references/path-portability.md) when preparing script inputs. Accept a DOI, title, or article URL. Resolve ambiguous titles before downloading. For lists, use sequential processing unless parallel work is requested; then read [parallel workflow](references/parallel-workflow.md), identify the known hosting platforms and access routes, and assign ownership before dispatch.
3. Create one TaskSpace for the user goal and reuse its ID across rounds; explicitly requested parallel work may use separate spaces as described in the parallel workflow. Reuse the current ego profile and login. A new tab or TaskSpace is **not** a fresh profile or a new institutional login.

For institutional route selection or publisher-specific navigation, read [publisher routes](references/publisher-routes.md). For the required output fields and status definitions, read [evidence record](references/evidence-record.md).

## Acquire

1. Use the user's specified or already working access route, preserving the current network connection and browser login. Campus access, an institution VPN, WebVPN and retained publisher authentication may apply separately or together; select by current evidence using [publisher routes](references/publisher-routes.md). When WebVPN is needed, use its actual portal entry and produced URLs rather than inventing rewritten hosts.
2. Confirm the article's title and DOI on the visible page. Inspect the access control or institution menu when relevant. Record institutional recognition separately from open-access status: recognition alone does not prove the paper requires a subscription.
3. For a single capture or loaded viewer, use the shared [capture lock](references/parallel-workflow.md#serialize-capture-globally); arm the event before clicking and save in the same round, or use `captureViewer`. A busy result leaves the paper queued. Pass the server's declared byte total as `expectedBytes` when the file is large enough for a truncated transfer to look plausible: a resolved save that is short of that total returns `save_size_mismatch`, not a candidate. For user-requested multi-agent downloads, follow the [shared record pool](references/batch-download-tools.md#shared-pool-for-independent-workers): one session holds the shared lease while workers use `triggerPoolDownload` in their own spaces and an observer persists completed browser records. Workers keep their Pages and do not use SDK download objects in this session. Keep the lease through all actual CLI exits and candidate classification, then release it from the coordinator. The older single-coordinator `collectDownloads` remains available for event diagnostics. Neither helper repairs ego's SDK association or cancellation internals.
4. Record the observed route and any intervention. Do not store signed PDF URLs, cookies, credentials, SSO tickets, or entire browser state in the manifest. Preserve screenshots locally only when they contain no unnecessary personal information.

Use the visible browser for the access and download claim. An HTTP status, copied URL, or HTML file named `.pdf` is not proof of a successful PDF download. Do not replace a failed browser route silently with an open-access mirror.

## Verify

Run the bundled helper with a Python environment containing `pypdf`:

```text
python scripts/verify_pdf.py /absolute/path/paper.pdf --doi 10.xxxx/example --title "Expected article title"
```

The helper returns file validity, SHA-256, page count, and first-two-page text identity evidence. Supply an expected DOI or title. For a pool, run `assign_candidates.py` as described in [download tools](references/batch-download-tools.md#match-the-whole-pool-before-delivery), then review first pages before copying accepted files into article names. A conflicting primary DOI candidate overrides a title match; multiple primary DOI candidates require review. Treat `identity_match: null` as unresolved. Its DOI heuristics do not establish browser provenance or replace visual review; see [diagnosis](references/diagnostic-guide.md) for limits. If an explicit DOI is absent, inspect the title and authors on the first page.

Inspect the rendered first page in the browser or a local PDF render. If a publisher cover precedes the article, inspect the article's first page too. Compare the title and DOI to the request and check that the document is readable. Record the visual check separately. Do not label a file verified based only on its extension, hash, or page count.

## Handle interruptions

- For a webpage verification challenge, first follow [verification handling](references/diagnostic-guide.md#handle-webpage-verification): inspect and attempt the site's visible verification flow through ego's documented Page APIs, then inspect the result. A verification page alone does not require human handoff. Record whether the agent or user acted; do not change fingerprints to evade a block.
- When credentials, OTP, browser-owned permission prompts, or an unresolved verification require the user, record the [continuation checkpoint](references/evidence-record.md#continuation-checkpoint), hand off the same TaskSpace and state the exact action. After confirmation, follow [authentication continuation](references/diagnostic-guide.md#resume-after-user-authentication); a missing space does not establish login failure.
- On an explicit IP restriction, account lock, or repeated access denial, stop that publisher attempt and record the displayed error. Do not repeatedly reload, create another space, or switch exits to evade it.
- A single unexpected navigation merits inspection of the current page before any retry. Do not clear the user's profile, change global proxy/VPN settings, or restart the browser as a routine download step.
- If the user pauses a publisher, exclude its pages from testing until they explicitly resume it. Continue independent skill work or other requested publishers.

For a failed or stalled attempt, use [diagnosis](references/diagnostic-guide.md) to distinguish authentication, entitlement, security, capture, and identity problems. When the symptom is an interrupted or stalled transfer rather than a denial, measure bounded byte-range throughput and range support as described in [path throughput diagnosis](references/diagnostic-guide.md#separate-path-throughput-from-publisher-refusal) before attributing the failure to the publisher or the network. If a PDF viewer has loaded but no file was saved, use [viewer recovery](references/pdf-viewer-recovery.md) in the same TaskSpace. These adapt InstSci methods; they do not establish publisher support in ego.

## Deliver

Write a local manifest using [evidence record](references/evidence-record.md), alongside the PDF and minimal necessary evidence. Include failures honestly; a partly successful batch must retain per-paper status.

Finish the TaskSpace according to the ego guide after successful completion. Report the PDF path, paper identity, page count, and actual access route. State any manual login/verification, reused session, or unresolved identity. Claim a new-session success only if that condition was actually tested.
