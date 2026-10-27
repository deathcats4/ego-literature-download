# Resolve paths in the current environment

The source file, persistent output, installed skill and ego executable are separate locations. A path in an old run record is evidence for that machine, not configuration for another machine.

- **Browser source:** use the exact absolute path from this batch's attributable download artifact or new browser download record. Custom download folders, redirected home folders and other drives need no special folder guess. If the reported path is unavailable to the process that copies it, record the failure; do not search Downloads/Temp or substitute an older PDF. Browser and collector must have access to the same filesystem path; remote browser paths do not automatically refer to local files.
- **Persistent output:** use the user's requested directory, or choose a directory under the current task workspace and record it. During development in this repository, use `runtime/runs/<timestamp>_<name>/`. Resolve it before launching ego and pass the absolute path as a script input. The ego round's cwd and environment variables are not inherited from the shell. Do not default to a remembered drive, username or `~/Downloads`.
- **Skill helpers:** discover this installation's actual skill directory from the current skill location; resolve its real filesystem location when an installation is a link. Use `node:path` and `pathToFileURL()` for imports; spaces, Unicode, `#` and `%` need proper URL encoding. Inside a helper, use `import.meta.url` for bundled resources. The existing capture lock already resolves relative to its module; keep its shared default even when output directories differ.
- **Ego executable:** follow the current installed ego-browser skill. Use the resolved `ego-browser` command (`Get-Command ego-browser` on PowerShell, `command -v ego-browser` on a POSIX shell) or the location discovered through that skill's installation instructions. A developer's versioned installation path is not a portable default.

Keep native filesystem paths in file APIs. Use file URLs only for imports that need them. Provide inputs through a UTF-8 script/config file using the current ego guide, rather than assembling a shell command from unescaped paths.

## Persist a completed native candidate

When persisting a completed browser download from the shared record pool, resolve `skillRoot`, `sourcePath`, `poolDir` and `completedBytes` from the current environment and download receipts, then use:

```js
const {join} = await import('node:path');
const {pathToFileURL} = await import('node:url');
const {persistCandidate} = await import(
  pathToFileURL(join(skillRoot, 'scripts', 'persist_candidate.mjs')).href
);
const candidate = await persistCandidate(sourcePath, poolDir, {
  expectedBytes: completedBytes,
});
```

[persist_candidate.mjs](../scripts/persist_candidate.mjs) checks the completed byte count, file stability during reading and PDF header, then writes a unique neutral filename without overwriting. It uses only the supplied source and output paths, retains the original and returns the copied hash. It does not discover browser receipts, prove completion from a stable partial file, parse paper identity, or manage CLI/lock lifetime. The caller must first establish native completion and receipt provenance, then apply content identity and visual verification. Keep original browser files by default; source cleanup needs exact batch ownership and a verified durable copy, not a Downloads/Temp directory whitelist copied from a developer's machine.

The helper accepts unrelated working directories, custom source/output directories and names containing Unicode, spaces, `#` and `%`. These path guarantees do not establish macOS/Linux browser integration, network-drive access or cross-host transfer support.
