"""Downloads the raw DVF files for Paris into data-raw/src/.

Source: "Demandes de valeurs foncières géolocalisées" on data.gouv.fr. The files
are national, so each one is streamed and only department 75 is kept. The full
run downloads about 500 MB. Run scripts/build_paris_sales.py afterwards.

Run: python3 scripts/fetch_dvf.py
"""
import csv
import gzip
import io
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data-raw", "src")
RESOURCE_URL = "https://www.data.gouv.fr/api/1/datasets/r/{}"

# Output file name -> data.gouv.fr resource id. An id stays valid across DVF
# releases and always redirects to the latest version of that period's file.
RESOURCES = {
    "paris-2022.csv": "8e32f824-9382-40b3-b0f5-3997aa4c4351",
    "paris-2023.csv": "c7cc1608-2e27-4754-8f59-54391ef363c6",
    "paris-2024.csv": "e7421d40-c719-459c-a942-38d3a0a23fdf",
    "paris-2025.csv": "b3a0c6d2-2a5a-45a3-81a8-9e860caf5e14",
    "paris-2026-s1.csv": "4fa87df4-ac08-447f-8460-2daed16c2cfb",
}


def fetch_paris_rows(resource_id: str, path: str) -> int:
    """Stream one national DVF file and save its Paris rows.

    Parameters
    ----------
    resource_id : str
        The data.gouv.fr resource id of the national ``.csv.gz`` file.
    path : str
        The CSV file to write.

    Returns
    -------
    int
        The number of Paris rows written.

    Examples
    --------
    .. code-block:: python

        fetch_paris_rows("4fa87df4-ac08-447f-8460-2daed16c2cfb", "paris-2026-s1.csv")
    """
    # Write to a temporary name first, because the build script reads every
    # paris-*.csv file and must never pick up a partial download.
    partial = f"{path}.part"
    request = urllib.request.Request(
        RESOURCE_URL.format(resource_id),
        headers={"User-Agent": "paris-property-sales-data-fetch"},
    )
    count = 0
    with urllib.request.urlopen(request) as response, open(
        partial, "w", encoding="utf-8", newline=""
    ) as out:
        lines = io.TextIOWrapper(gzip.GzipFile(fileobj=response), encoding="utf-8", newline="")
        reader = csv.reader(lines)
        header = next(reader)
        department = header.index("code_departement")
        writer = csv.writer(out, lineterminator="\n")
        writer.writerow(header)
        for row in reader:
            if row[department] == "75":
                writer.writerow(row)
                count += 1
    os.replace(partial, path)
    return count


def main() -> None:
    """Download every configured period into ``data-raw/src/``."""
    os.makedirs(OUT, exist_ok=True)
    for name, resource_id in RESOURCES.items():
        print(f"{name}: downloading", flush=True)
        count = fetch_paris_rows(resource_id, os.path.join(OUT, name))
        print(f"{name}: {count} rows", flush=True)


if __name__ == "__main__":
    main()
