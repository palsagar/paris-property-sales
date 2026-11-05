# Sales data stays out of git and out of the image

Each record in the sales dataset links a price to a street address and coordinates. The DGFiP says that the DVF file contains personal data and that reuse must not allow indexing by external search engines. This repository is public, and a public Git repository cannot guarantee that condition, so neither the raw DVF files nor the built dataset are in git. Anyone can rebuild them from data.gouv.fr with the two scripts in `scripts/`.

The sales data is also not in the Docker image. Coolify builds from the public repository, which has no data, and an image without data is safe to store in any registry. The data lives in a folder on the VPS, and the container mounts it at `/app/data`. New data needs a file copy and a restart, with no rebuild.

## Consequences

- A fresh clone cannot run until someone runs the two scripts.
- The mount replaces the image's data folder, so the folder on the server must hold all three data files. The process stops at startup if the sales file is missing.
