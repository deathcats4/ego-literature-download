# Publisher routes

Read this file when institutional access or publisher-specific behavior affects a download. Route-selection guidance is adapted from InstSci; only sections explicitly marked ego-tested describe actual ego download evidence.

## Select an institutional route

1. Use the institution and entry route supplied by the user or established in the current task. Ask only if the required subscription institution cannot be resolved; a personal publisher login does not identify it.
2. Preserve a working route, including the current network connection and browser login. If a requested PDF is already accessible, download it without adding a login detour. If the user specified a school portal or VPN route, start with that route. With no established entry, inspect the public article in the current environment before selecting an institutional route.
3. When access is unresolved and no route was specified, inspect the article's `Institutional Access`, `Access through your organization`, Shibboleth, OpenAthens, or CARSI controls. Follow the actual institution search/selection flow, hand off credentials when needed, and apply [verification handling](diagnostic-guide.md#handle-webpage-verification) to webpage challenges. These are route candidates inherited from InstSci, not ego-tested publisher capabilities.
4. Use WebVPN when the user's institution provides it and the portal offers the relevant publisher. For an untested publisher, treat this as a trial route. A successful run establishes only the observed paper/session conditions.
5. If WebVPN fails without a security stop condition, inspect the visible error before trying an available article-page institutional route. Record both attempts. On explicit IP/account restrictions or repeated denial, follow the stop rules in `SKILL.md` instead of changing routes.

Record institution recognition, OA status, and article entitlement separately. A recognized institution can still lack access to a particular journal or year. An explicit subscription/access denial establishes that route's observed entitlement result; an unexplained 403 alone does not.

Network access and browser authentication are separate and may work together. Campus-network access may authorize a public publisher page; an institution's VPN client may provide that access through a network tunnel; WebVPN uses a portal and rewritten routes; retained portal or publisher authentication may still be needed in any of these environments. Preserve the user's working setup instead of imposing a universal direct-first or VPN-first order. Follow institution login only when current article access requires it. If a required network VPN is not connected, record that prerequisite and ask the user to connect it rather than treating a browser login as a substitute.

Record the observed public hosts, article access statement, reused authentication and user-reported network/VPN conditions separately; mark unconfirmed conditions as unknown. A canonical publisher URL can also be reached through a VPN tunnel. No WebVPN navigation or new login in a run does not prove that VPN was off or that IP alone supplied access. Do not clear the profile or disconnect a working VPN to manufacture that comparison.

## School WebVPN

Use the user's school library or WebVPN portal. The portal can rewrite both the article host and a separate PDF host; preserve the actual route it produces. An external proxy and school WebVPN may interact, but a failed paper request does not identify which component failed. Record the visible error before diagnosing network settings.

Keep institution domains and identity in the user's local run record rather than embedding a school-specific configuration in this reusable skill. An existing portal session may carry into a new TaskSpace because the profile is shared.

## GeoScienceWorld / Silverchair

Ego-tested with an existing school login: school WebVPN portal → GeoScienceWorld → search results or a previously observed article path → article → PDF popup on a Silverchair watermark host → browser PDF viewer → download. Evidence includes Economic Geology and GSA Bulletin articles, with ego-only recovery and file checks. These reused existing sessions; fresh institutional login and subscription-only entitlement remain unproven. For concurrent work, follow [parallel workflow](parallel-workflow.md).

- The institution menu may show recognition while personal `Sign In` remains available. These are separate login states.
- A PDF may live on another hostname and carry a short-lived signed query. Do not log that query or reuse it as a permanent article URL.
- A search filter may expose a navigation URL without triggering navigation. Inspect the rendered control and its actual destination before using that observed URL; do not guess private endpoints.
- In a WebVPN page, DOM `location` or an anchor's resolved `href` can point at the canonical publisher domain. Prefer clicking the visible link. If an observed relative destination must be resolved, use the browser API's current `page.url()` as the base and confirm the resulting route; this difference was observed during the serial trial.
- An accessible PDF is not enough to classify the article as subscription-only. Record OA status as unknown unless an explicit indicator establishes it.

## Other ego-tested routes

These observations establish the tested papers and reused sessions, not all journals or subscription coverage. Keep exact paper identities and environment details in local run records.

| Platform | Route hint |
| --- | --- |
| Elsevier / ScienceDirect | Normal route: open the DOI/article page, confirm its title and DOI, then click the visible `View PDF` control. Wait for the PDF viewer to finish loading and expose its Download control; save from that viewer with `captureViewer` when the control is addressable through the current ego Page API. The viewer may be served from `pdf.sciencedirectassets.com`. Verify the saved candidate with `verify_pdf.py`. A visible Turnstile challenge is an interruption, not part of the normal route; follow the challenge guidance below when one appears. |
| Nature | Use the visible Download PDF control. A `*_reference.pdf` URL can still lead to a readable article; verify the document's content and version. |
| Springer Link | Follow the article's institution access flow (CARSI was used in a tested case). Recheck article-specific access after login; a retained session does not prove fresh-login support or universal coverage. |
| Wiley / AGU | A security check and PDF entitlement are separate. The tested reader route exposed an observed `/doi/pdfdirect/<DOI>?download=true` link; capture on the actual destination Page. `ERR_ABORTED` can accompany a real download, so inspect the file. |
| ACS | The visible article PDF link opened a native viewer popup. Use the rendered search control and the popup's visible Download control. |
| Copernicus | The article PDF opens a viewer; its load may carry most of the transfer. Wait for the current viewer's Download control and use viewer recovery if it is still loading. |
| MDPI / Frontiers | Use the article's own PDF route; MDPI pages may include unrelated PDF flyers. Compare a reliable server-declared byte total when available, especially for large files. The agent can adjust concurrency to current transfer behavior. |
| PLOS | Resolve a visible consent overlay. The PDF may open a short-lived tab; inspect its destination and collect the actual browser record or save from the loaded viewer. |
| PeerJ | The Download button opens a modal containing the actual `/articles/<id>.pdf` link. Use that observed link, then inspect the saved file. |
| OUP / Silverchair | The article PDF may redirect to a Silverchair reader. Wait for its Download control; DOI text can use an OUP article identifier, so title and other identity evidence may be needed. |
| IOP | The PDF may include a publisher cover; inspect the article page after the cover when identity evidence is unclear. |
| Taylor & Francis | The tested reader's PDF menu did not trigger a download; navigating to its observed PDF href with a download wait did. Use the current page's observed destination. |

## Untested routes and capability claims

Start from the visible article and access controls. Do not claim support until a PDF has been downloaded and checked. Keep a publisher note only when it contains a demonstrated behavior that changes the workflow.

InstSci publisher catalogs, matrices, selectors, and old successes can suggest where to look. They do not transfer CloakBrowser capability verdicts, login state, signed links, or API calls into ego. Adapt browser actions using the current ego guide and record new evidence before adding an ego-tested route here.

Publisher pauses and previous run evidence belong in the user's task record. Do not turn a session-specific restriction or a previously validated session into a general capability claim.

## Executable route policy

Workers that want optional prior-route hints can import
[`scripts/publisher_route_policy.mjs`](../scripts/publisher_route_policy.mjs). The
pure `publisherRoute(name, {viewerLoaded})` helper does not navigate or capture
anything. A known route is a hint, not a required path. Copernicus and ACS return
`wait_for_viewer_then_observe_download` until the current viewer's Download
control has been observed. MDPI and Frontiers select the article PDF URL and
browser-record collection, with MDPI's large-file policy recommending a
server byte total. An unlisted publisher returns `route_status: unlisted` and
continues to live page observation or capture; it is not an unsupported verdict.
The executable regression cases
are in [`tests/test_publisher_route_policy.mjs`](../tests/test_publisher_route_policy.mjs).

For Elsevier, `publisherRoute('elsevier')` encodes the reusable route stages:
article PDF link, viewer load, then capture from the loaded viewer. It is a
decision hint for the live workflow, not a page automation script. The reusable
capture step is [`captureViewer`](../scripts/capture_viewer.mjs), which arms the
download wait before clicking the observed viewer control and saves the result
as an unverified candidate. PDF structure and article identity remain the
responsibility of [`verify_pdf.py`](../scripts/verify_pdf.py). This split keeps
stable steps reusable while leaving title/DOI checks and changing page controls
to live observation.
