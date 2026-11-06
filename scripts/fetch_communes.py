"""Downloads the Commune boundaries into data-raw/communes.geojson.

Source: contours-administratifs, the 50 m simplified Commune outlines. The
file keeps the features of the Communes in communes.py. It holds no prices.
update_data.py does not call this script, because boundaries change far less
often than Sales. Run it when the Commune list changes.

Run: python3 scripts/fetch_communes.py
"""
import gzip
import json
import os
import urllib.request
from typing import Any

from communes import COMMUNE_CODES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data-raw", "communes.geojson")
URL = "https://contours-administratifs.s3.rbx.io.cloud.ovh.net/2026/geojson/communes-50m.geojson.gz"
# Seconds without data before a request fails.
TIMEOUT_SECONDS = 60


def keep_communes(collection: dict[str, Any]) -> dict[str, Any]:
    """Keep the features of the listed Communes.

    Parameters
    ----------
    collection : dict of str to Any
        A GeoJSON feature collection whose features have ``properties.code``.

    Returns
    -------
    dict of str to Any
        A feature collection with only the Communes in ``COMMUNE_CODES``.

    Raises
    ------
    ValueError
        If a listed Commune has no feature. The message names the codes.

    Examples
    --------
    .. code-block:: python

        kept = keep_communes(json.load(open("communes-50m.geojson")))
    """
    wanted = set(COMMUNE_CODES)
    features = [f for f in collection["features"] if f["properties"]["code"] in wanted]
    missing = sorted(wanted - {f["properties"]["code"] for f in features})
    if missing:
        raise ValueError(f"No boundary for these Commune codes: {', '.join(missing)}")
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    """Download the outlines and write the file for the listed Communes."""
    request = urllib.request.Request(URL, headers={"User-Agent": "paris-property-sales-data-fetch"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        collection = json.loads(gzip.decompress(response.read()))
    try:
        kept = keep_communes(collection)
    except ValueError as error:
        raise SystemExit(str(error))
    with open(OUT, "w", encoding="utf-8") as out:
        json.dump(kept, out, ensure_ascii=False, separators=(",", ":"))
    print(f"communes.geojson: {len(kept['features'])} features", flush=True)


if __name__ == "__main__":
    main()
