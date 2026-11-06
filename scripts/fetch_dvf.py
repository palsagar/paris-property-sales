"""Downloads the raw DVF file for Paris into data-raw/src/paris.csv.

Source: "Demandes de valeurs foncières géolocalisées" on data.gouv.fr. The file
is the national "fichier unique", found by its title in the dataset's
resource list. It is streamed and only department 75 is kept, with every date.
The release month goes to data-raw/src/release.txt. The download is about
610 MB. Run scripts/build_paris_sales.py afterwards.

Run: python3 scripts/fetch_dvf.py
"""
import csv
import gzip
import io
import json
import os
import re
import urllib.request
from collections.abc import Iterable, Mapping
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data-raw", "src")
DATASET_URL = "https://www.data.gouv.fr/api/1/datasets/demandes-de-valeurs-foncieres-geolocalisees/"
# The request header that every call to data.gouv.fr sends.
HEADERS = {"User-Agent": "paris-property-sales-data-fetch"}
# The title of the national file contains this text. The resource id and the
# URL change at each release, so the title is the stable way to find the file.
TITLE_MARKER = "fichier unique"
# Seconds without data before a request fails. It limits a stalled connection, not the length of a download.
TIMEOUT_SECONDS = 60


def copy_paris_rows(reader: Iterable[list[str]], writer: Any) -> int:
    """Copy the rows of department 75, with every date.

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
    writer.writerow(header)
    count = 0
    for row in rows:
        if row[department] == "75":
            writer.writerow(row)
            count += 1
    return count


def find_release(dataset: Mapping[str, Any]) -> tuple[str, str]:
    """Find the national file in the dataset and the month of its release.

    Parameters
    ----------
    dataset : Mapping[str, Any]
        The data.gouv.fr dataset, with a ``resources`` list.

    Returns
    -------
    tuple of str
        The download URL and the release month as ``YYYY-MM``.

    Raises
    ------
    ValueError
        If no resource, or more than one, has "fichier unique" in its title
        (ignoring case), or if its ``last_modified`` date is not valid.

    Examples
    --------
    .. code-block:: python

        url, month = find_release(fetch_dataset())
    """
    resources = dataset["resources"]
    matches = [r for r in resources if TITLE_MARKER in r["title"].lower()]
    if len(matches) != 1:
        titles = ", ".join(r["title"] for r in resources)
        raise ValueError(
            f'Expected one resource with "{TITLE_MARKER}" in its title, found {len(matches)}. '
            f"Titles: {titles}"
        )
    resource = matches[0]
    month = resource["last_modified"][:7]
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError(f'Cannot read the release month from last_modified "{resource["last_modified"]}"')
    return resource["url"], month


def fetch_dataset() -> dict[str, Any]:
    """Get the dataset description from data.gouv.fr.

    Returns
    -------
    dict of str to Any
        The parsed JSON of ``DATASET_URL``.

    Examples
    --------
    .. code-block:: python

        resources = fetch_dataset()["resources"]
    """
    request = urllib.request.Request(DATASET_URL, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.load(response)


def fetch_paris_rows(url: str, path: str) -> int:
    """Stream the national DVF file and save its Paris rows.

    Parameters
    ----------
    url : str
        The download URL of the gzip-compressed national file.
    path : str
        The CSV file to write.

    Returns
    -------
    int
        The number of Paris rows written.

    Examples
    --------
    .. code-block:: python

        fetch_paris_rows(url, "data-raw/src/paris.csv")
    """
    # Write to a temporary name first, so that a failed download never leaves a
    # partial paris.csv for the build script to read.
    partial = f"{path}.part"
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response, open(
        partial, "w", encoding="utf-8", newline=""
    ) as out:
        lines = io.TextIOWrapper(gzip.GzipFile(fileobj=response), encoding="utf-8", newline="")
        count = copy_paris_rows(csv.reader(lines), csv.writer(out, lineterminator="\n"))
    os.replace(partial, path)
    return count


def main() -> None:
    """Download the national file into ``data-raw/src/`` and record its release month."""
    os.makedirs(OUT, exist_ok=True)
    try:
        url, month = find_release(fetch_dataset())
        print(f"paris.csv: downloading the {month} release", flush=True)
        count = fetch_paris_rows(url, os.path.join(OUT, "paris.csv"))
    except ValueError as error:
        # This includes a file without a code_departement column.
        raise SystemExit(str(error))
    print(f"paris.csv: {count} rows", flush=True)
    # Write the month only after the CSV is in place, so that release.txt never
    # names a release whose file is missing.
    with open(os.path.join(OUT, "release.txt"), "w", encoding="utf-8") as release:
        release.write(month)
    print(f"release.txt: {month}", flush=True)


if __name__ == "__main__":
    main()
