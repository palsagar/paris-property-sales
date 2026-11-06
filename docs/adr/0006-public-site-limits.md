---
status: accepted, not yet implemented
---

# The public site limits what it exposes

The site is public, and the DGFiP states these conditions for DVF: the file contains personal data, its use must not allow people to be re-identified indirectly, and reuse must not allow indexing by external search engines. We accept three limits because of them, even though each one makes the site less useful or harder to find.

- **Sale location only.** A Visitor sees the street and a position rounded to about 100 m, and never the house number. The build script removes the exact details, so the dataset itself cannot leak them through an API bug. This lowers the risk of re-identification but does not remove it, especially on a short street. No Sale holds its `id_mutation`: the build uses it to group rows and then drops it, and each Sale gets a new id that does not exist in the public DVF file.
- **No search engines.** The whole site blocks indexing, because search engines can read pages drawn by JavaScript, including the sales list. Visitors reach the site through links.
- **A private API.** The API serves only this site. It has no open CORS, it has rate limits, it caps the records in one response, and exports cover only what is on screen. This makes bulk copying harder but cannot prevent it.

## Accepted risk: a Sale can still be matched

Removing the `id_mutation` stops the simple join to the public DVF file. A Visitor can still match a Sale, because date, price, surface and street together identify 404,405 of the 404,582 Sales uniquely. We accept this risk before launch, because hiding those details would remove what the site is for. The DGFiP condition against indirect re-identification is therefore not fully met by this choice.

## Considered options

- **Exact addresses** would be the most useful, but they carry the highest risk, and they cannot be taken back once published.
- **Statistics by Area only** would carry the lowest risk, but buyers would lose the ability to see individual Sales.
- **A landing page open to search engines**, showing only Area statistics, would help people find the site. It could be added later.
