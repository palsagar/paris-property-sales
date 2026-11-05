"""Downloads the raw DVF file for Paris into data-raw/src/paris.csv.

Source: "Demandes de valeurs foncières géolocalisées" on data.gouv.fr. The file
is the national five-year file, so it is streamed and only department 75 is
kept, from FIRST_DATE onward. The download is about 610 MB. Run
scripts/build_paris_sales.py afterwards.

Run: python3 scripts/fetch_dvf.py
"""
import csv
import gzip
import io
import os
import urllib.request
from collections.abc import Iterable
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data-raw", "src")
RESOURCE_URL = "https://www.data.gouv.fr/api/1/datasets/r/{}"

# The data.gouv.fr resource id of the five-year national file. An id stays valid
# across DVF releases and always redirects to the latest version of the file.
RESOURCE_ID = "d7933994-2c66-4131-a4da-cf7cd18040a4"
# The five-year file starts before the period the site covers. Chunk 2 removes
# this cutoff once the build script reads the whole file.
FIRST_DATE = "2022-01-01"


def copy_paris_rows(reader: Iterable[list[str]], writer: Any) -> int:
    """Copy the Paris rows dated from ``FIRST_DATE`` onward.

    Parameters
    ----------
    reader : Iterable[list[str]]
        CSV rows. The first row is the header.
    writer : Any
        A ``csv.writer`` that receives the header and the kept rows.

    Returns
    -------
    int
        The number of data rows written, without the header.

    Examples
    --------
    .. code-block:: python

        with open("national.csv", newline="") as source, open("paris.csv", "w", newline="") as out:
            copy_paris_rows(csv.reader(source), csv.writer(out))
    """
    rows = iter(reader)
    header = next(rows)
    department = header.index("code_departement")
    date = header.index("date_mutation")
    writer.writerow(header)
    count = 0
    for row in rows:
        # ISO dates compare correctly as strings.
        if row[department] == "75" and row[date] >= FIRST_DATE:
            writer.writerow(row)
            count += 1
    return count


def fetch_paris_rows(path: str) -> int:
    """Stream the national DVF file and save its Paris rows.

    Parameters
    ----------
    path : str
        The CSV file to write.

    Returns
    -------
    int
        The number of Paris rows written.

    Examples
    --------
    .. code-block:: python

        fetch_paris_rows("data-raw/src/paris.csv")
    """
    # Write to a temporary name first, so that a failed download never leaves a
    # partial paris.csv for the build script to read.
    partial = f"{path}.part"
    request = urllib.request.Request(
        RESOURCE_URL.format(RESOURCE_ID),
        headers={"User-Agent": "paris-property-sales-data-fetch"},
    )
    with urllib.request.urlopen(request) as response, open(
        partial, "w", encoding="utf-8", newline=""
    ) as out:
        lines = io.TextIOWrapper(gzip.GzipFile(fileobj=response), encoding="utf-8", newline="")
        count = copy_paris_rows(csv.reader(lines), csv.writer(out, lineterminator="\n"))
    os.replace(partial, path)
    return count


def main() -> None:
    """Download the five-year file into ``data-raw/src/``."""
    os.makedirs(OUT, exist_ok=True)
    print("paris.csv: downloading", flush=True)
    count = fetch_paris_rows(os.path.join(OUT, "paris.csv"))
    print(f"paris.csv: {count} rows", flush=True)


if __name__ == "__main__":
    main()
