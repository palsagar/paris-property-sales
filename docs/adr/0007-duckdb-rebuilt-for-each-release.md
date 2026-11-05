---
status: accepted, not yet implemented
---

# The data lives in one DuckDB file, rebuilt by hand for each DVF release

The site is growing from 128,114 Sales in Paris to about 400,000 Sales in Paris and 135 Communes, so the arrays in memory from [decision record 2](0002-in-memory-data-no-database.md) no longer fit. We store the Sales in one DuckDB file, which the server opens read-only. A person rebuilds the file after each DVF release, copies it to the server and restarts the application. The figures are calculated in SQL, and medians stay exact.

DuckDB suits this site because the server never writes, and because its figures are mostly medians over many rows. SQLite was the obvious choice, but it has no median function, so every row must first move into JavaScript. In November 2026 we tested the work behind one Selection change on 611,216 real Sales, on one Apple Silicon Mac.

| Option | Whole dataset | One Arrondissement |
| --- | --- | --- |
| Today's approach (JavaScript objects) | 166 ms | 28 ms |
| Compact arrays in memory | 60 ms | 25 ms |
| SQLite with indexes | 410 ms | 140 ms |
| SQLite with precomputed monthly histograms (approximate medians) | 90 ms | 87 ms |
| DuckDB | 23 ms | 4 ms |

We do not run a scheduled job. The DGFiP publishes DVF only in April and October, so a monthly job would almost always find nothing. It would also need a data folder that the container can write to, a way to swap the data while the server runs, and alerts when it fails. One update command with checks gives most of the safety at much lower cost. The cost is that someone must remember to run it, and the site stays on the old release until they do.

Each release rewrites about five years of data and changes every `id_mutation`, so the file is always rebuilt in full and never updated in part.

## Consequences

- The application image gains a native package, which must work on x64 and ARM64.
- All calculations in the routes move from TypeScript to SQL, so tests must confirm that they give the same results.
- A server must still restart to show new data, as it does today.
- The data scripts stay in Python and now need the `duckdb` package, so they no longer use only the standard library.
