---
name: ego-literature-download
description: Download academic paper PDFs through ego lite using the user's existing publisher or institutional login. Use for a DOI, title, article URL, or list of papers, including school WebVPN access, visible browser downloads, and PDF identity verification. Keep this workflow independent of InstSci and its browser profiles.
metadata:
  version: "0.5.15"
---

# Literature downloads through ego lite

Obtain the requested paper through a visible ego browser workflow, then verify the saved file. This skill uses ego-browser; it does not invoke InstSci, import its cookies, or modify its configuration.

Operate and recover the browser exclusively through the current `ego-browser` CLI/API. Do not use computer-use, desktop automation, or native window controls as a fallback, including to restore a minimized window. If ego cannot perform the required operation, record the limitation and hand off the same TaskSpace for the user to act. Local PDF parsing and rendering remain part of file verification.

## Start

1. Read the installed `ego-browser` skill and run `ego-browser skill`. Follow its current API and platform instructions; do not copy an old browser API example into a new task without checking it.
2. Establish the paper identifier and an absolute output directory in the current task's environment. Resolve the actual installed skill and ego CLI locations on this machine; follow [portable paths](references/path-portability.md) when preparing script inputs. A DOI or article URL is enough to start; open it and act on the live page. Resolve a title only when it does not identify a unique paper. For lists, start independent papers without pre-classifying publishers, access routes, or groups. Choose parallelism from available browser capacity and the task; see [parallel workflow](references/parallel-workflow.md) when multiple workers are involved.
3. Create one TaskSpace for the user goal and reuse its ID across rounds; explicitly requested parallel work may use separate spaces as described in the parallel workflow. Reuse the current ego profile and login. A new tab or TaskSpace is **not** a fresh profile or a new institutional login.

For institutional route selection or publisher-specific navigation, read [publisher routes](references/publisher-routes.md). For the required output fields and status definitions, read [evidence record](references/evidence-record.md).

## Acquire

1. Open the DOI/article URL using the current browser session and inspect the page. Follow the visible route that is available, including campus access, an institution VPN, WebVPN, or retained publisher authentication. Use [publisher routes](references/publisher-routes.md) as prior evidence, not a prerequisite or exhaustive support list. When WebVPN is needed, use its actual portal entry and produced URLs rather than inventing rewritten hosts.
2. Confirm the article's title and DOI on the visible page. Inspect the access control or institution menu when relevant. Record institutional recognition separately from open-access status: recognition alone does not prove the paper requires a subscription.
3. Arm the download event before clicking the visible PDF control, then save in the same round, or use `captureViewer`. Start other independent papers while transfers run; when a PDF viewer is readable and its Download control is visible, trigger it promptly. There is no shared capture lock or global queue. Independent Pages may capture concurrently. For lists, use the [batch tools](references/batch-download-tools.md) when their record collection helps; otherwise use the direct browser flow. Pass the server's declared byte total as `expectedBytes` when available and useful for detecting truncation. Give the user brief progress updates as pages resolve: report the observed state, action taken, result, and what is still running or blocked. A failed paper should not stop independent papers.
4. Record the observed route and any intervention. Do not store signed PDF URLs, cookies, credentials, SSO tickets, or entire browser state in the manifest. Preserve screenshots locally only when they contain no unnecessary personal information.

Use the visible browser for the access and download claim. An HTTP status, copied URL, or HTML file named `.pdf` is not proof of a successful PDF download. Do not replace a failed browser route silently with an open-access mirror.

## Verify

Run the bundled helper with a Python environment containing `pypdf` when file identity or integrity needs checking:

```text
python scripts/verify_pdf.py /absolute/path/paper.pdf --doi 10.xxxx/example --title "Expected article title"
```

The helper returns file validity, SHA-256, page count, and first-two-page text identity evidence. Supply an expected DOI or title. A clear match with no conflicting primary DOI is normally enough for an unambiguous text PDF. Inspect a rendered page when the helper reports conflict or ambiguity, text is insufficient, the PDF is scanned, a publisher cover may obscure the article, or the task requires strict visual review. A conflicting primary DOI overrides a title match; multiple primary DOI candidates require review. Treat `identity_match: null` as unresolved. The helper establishes neither browser provenance nor visual appearance; see [diagnosis](references/diagnostic-guide.md) for limits. If an explicit DOI is absent, match the title and available bibliographic details; use a visual check if they do not establish identity clearly.

When visual review is needed, inspect the first article page in the browser or a local PDF render; if a publisher cover precedes it, inspect both. Compare the visible identity and readability. Do not treat a file extension, hash, page count, or visual appearance alone as identity proof.

## Handle interruptions

- For a webpage verification challenge, follow [verification handling](references/diagnostic-guide.md#handle-webpage-verification): inspect the page, operate visible steps through ego's documented Page APIs, and re-observe after each step. A verification page alone does not require human handoff. Continue the same Elsevier paper when the challenge presents a usable next step; hand off only when it is unreadable, needs user-only input, or loops without progress. Record whether the agent or user acted; do not change fingerprints to evade a block.
- When credentials, OTP, browser-owned permission prompts, or an unresolved verification require the user, record the [continuation checkpoint](references/evidence-record.md#continuation-checkpoint), hand off the same TaskSpace and state the exact action. After confirmation, follow [authentication continuation](references/diagnostic-guide.md#resume-after-user-authentication); a missing space does not establish login failure.
- On an explicit IP restriction, account lock, or repeated access denial, stop that publisher attempt and record the displayed error. Do not repeatedly reload, create another space, or switch exits to evade it.
- A single unexpected navigation merits inspection of the current page before any retry. Do not clear the user's profile, change global proxy/VPN settings, or restart the browser as a routine download step.
- If the user pauses a publisher, exclude its pages from testing until they explicitly resume it. Continue independent skill work or other requested publishers.

For a failed or stalled attempt, inspect the current page, error and browser download records first, then use [diagnosis](references/diagnostic-guide.md) for the observed problem. Measure byte-range throughput only after repeated interruptions, when investigating root cause, or when the user asks. If a PDF viewer has loaded but no file was saved, use [viewer recovery](references/pdf-viewer-recovery.md) in the same TaskSpace. These adapt InstSci methods; they do not establish publisher support in ego.

## Deliver

For an ordinary single-paper request, report the saved path, observed paper identity, PDF validity and page count, plus any unresolved point. Do not create a full manifest by default. For batches, recovery, user handoff, or reproducibility work, use the [full evidence record](references/evidence-record.md) and retain per-paper outcomes and failures.

Finish the TaskSpace according to the ego guide after successful completion. Report the PDF path, paper identity, page count, and actual access route. State any manual login/verification, reused session, or unresolved identity. Claim a new-session success only if that condition was actually tested.
