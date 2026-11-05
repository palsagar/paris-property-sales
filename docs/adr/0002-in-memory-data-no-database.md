---
status: superseded by decision record 7, and the code follows this record until issue #2 is complete
---

# Data lives in memory, with no database

The server loads one JSON file at startup and calculates every response from arrays in memory. The site has 128,114 records that change only with a new DVF release, it has no writes, and it uses about 355 MB of memory. A database would add a service to run and back up, with no benefit at this size. Responses stay fast through indexes by Area, a response cache and a warm-up at startup.

The original project recorded no reasons for this choice, so these reasons are inferred from the code and the measured figures.

`lib/db` is unused template code, and it does not mean a database is planned. A database becomes worth considering if the data grows well beyond Paris, or if the site starts to accept writes.

## Consequences

- A server must restart to show new data.
- Memory use grows with the dataset.
- All data is in one process, so a second server would hold its own copy.
