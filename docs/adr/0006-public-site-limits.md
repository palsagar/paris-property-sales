---
status: accepted, not yet implemented
---

# The public site limits what it exposes

The site is public, and the DGFiP states these conditions for DVF: the file contains personal data, its use must not allow people to be re-identified indirectly, and reuse must not allow indexing by external search engines. We accept three limits because of them, even though each one makes the site less useful or harder to find.

- **Sale location only.** A Visitor sees the street and a position rounded to about 100 m, and never the house number. The build script removes the exact details, so the dataset cannot leak them through an API bug. This lowers the risk of re-identification but does not remove it, especially on a short street.
- **No search engines.** The whole site blocks indexing, because search engines can read pages drawn by JavaScript, including the sales list. Visitors reach the site through links.
- **A private API.** The API serves only this site. It has no open CORS, it has rate limits, it caps the records in one response, and exports cover only what is on screen. This makes bulk copying harder but cannot prevent it.

## Considered options

- **Exact addresses** would be the most useful, but they carry the highest risk, and they cannot be taken back once published.
- **Statistics by Area only** would carry the lowest risk, but buyers would lose the ability to see individual Sales.
- **A landing page open to search engines**, showing only Area statistics, would help people find the site. It could be added later.
