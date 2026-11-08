# Local graph verification

The local CodeGraph initialisation indexed the new source and later exploration returned current API/web source with callers. `codegraph sync` completed successfully. Generated index data remains ignored under `.codegraph`.

The following command was exercised through `scripts/refresh-code-indexes.ps1 -Initial`:

```powershell
graphify extract C:\Projects\raymond-gray-vmms --code-only --no-cluster --max-workers 2
```

The completed extraction reported 35 code files, 340 nodes and 738 edges in `graphify-out/graph.json`. It explicitly skipped 30 non-code files with `no LLM extraction` and used no clustering. Those counts describe that extraction snapshot and will change with the application. This confirms the selected local code path; it is not an independent network audit or product correctness check.

CodeGraph served the actual transaction and session source used to investigate compiler and browser failures. The browser harness then caught a real sign-out display defect despite passing backend session tests. This illustrates the separate roles of navigation indexes, integration tests and user-path verification.
