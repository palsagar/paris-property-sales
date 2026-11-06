# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb==1.4.5"]
# ///
"""Builds the cleaned Paris residential sales dataset used by the API server.

Source: DVF géolocalisées (data.gouv.fr), the five-year file filtered to department 75.
Inputs (in data-raw/, not committed): src/paris.csv, src/release.txt, arr.geojson, q2.geojson
Outputs: artifacts/api-server/data/sales.duckdb (not committed), and
artifacts/api-server/boundaries/arrondissements.geojson and quartiers.geojson.

The finished file holds neither the house number nor the exact position.

Run: uv run scripts/build_paris_sales.py
"""
import csv
import json
import os
import re
import tempfile
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import date
from typing import Any, TypedDict

import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data-raw")
OUT = os.path.join(ROOT, "artifacts", "api-server", "data")
BOUNDARIES = os.path.join(ROOT, "artifacts", "api-server", "boundaries")

SOURCE = "DVF géolocalisées, data.gouv.fr (DGFiP / Etalab)"
DWELLINGS = ("Appartement", "Maison")
MIN_PRICE, MAX_PRICE = 20_000, 20_000_000
MIN_SURFACE, MAX_SURFACE = 9, 300
MIN_PPSM, MAX_PPSM = 2_000, 35_000
# Three decimal places of a degree are about 100 m, too coarse to find one building.
POSITION_DECIMALS = 3
# A new release may change the Sale count by at most this share of the previous count.
MAX_COUNT_CHANGE = 0.15
# The columns of the DVF file that this script reads.
EXPECTED_COLUMNS = (
    "id_mutation", "date_mutation", "nature_mutation", "valeur_fonciere", "adresse_nom_voie",
    "code_commune", "type_local", "surface_reelle_bati", "nombre_pieces_principales",
    "longitude", "latitude",
)


class Sale(TypedDict):
    id: str
    date: str
    type: str
    price: int
    surface: int
    pricePerSqm: int
    rooms: int
    arr: int
    quartier: str | None
    lon: float | None
    lat: float | None
    street: str


def round_coords(c: Any) -> Any:
    """Round every coordinate of a GeoJSON geometry to 5 decimals.

    This function is for boundary files, which keep 5 decimals. Sale positions
    do not use it. They are rounded to POSITION_DECIMALS.

    Parameters
    ----------
    c : list
        A position ``[lon, lat]``, or any nesting of positions as in a GeoJSON
        ``coordinates`` array.

    Returns
    -------
    list
        A new list with the same nesting and every number rounded.

    Examples
    --------
    .. code-block:: python

        round_coords([2.3456789, 48.8612345])  # [2.34568, 48.86123]
    """
    if isinstance(c[0], (int, float)):
        return [round(c[0], 5), round(c[1], 5)]
    return [round_coords(x) for x in c]


def load_geo(path: str, keep: Callable[[dict[str, Any]], dict[str, Any]]) -> dict[str, Any]:
    """Read a GeoJSON file and keep only the wanted properties.

    Parameters
    ----------
    path : str
        The GeoJSON file to read.
    keep : callable
        Receives the properties of one feature and returns the properties to keep.

    Returns
    -------
    dict
        A feature collection with the kept properties and coordinates rounded
        to 5 decimals.

    Examples
    --------
    .. code-block:: python

        arr_geo = load_geo("data-raw/arr.geojson", lambda p: {"arr": int(p["c_ar"])})
    """
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    feats = []
    for ft in d["features"]:
        feats.append(
            {
                "type": "Feature",
                "properties": keep(ft["properties"]),
                "geometry": {
                    "type": ft["geometry"]["type"],
                    "coordinates": round_coords(ft["geometry"]["coordinates"]),
                },
            }
        )
    return {"type": "FeatureCollection", "features": feats}


def point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    """Tell whether a point is inside a ring, with the ray casting method.

    Parameters
    ----------
    x : float
        The longitude of the point.
    y : float
        The latitude of the point.
    ring : list of list of float
        The ring as a list of ``[lon, lat]`` positions.

    Returns
    -------
    bool
        True when the point is inside the ring.

    Examples
    --------
    .. code-block:: python

        square = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]
        point_in_ring(1, 1, square)  # True
    """
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_geom(x: float, y: float, geom: dict[str, Any]) -> bool:
    """Tell whether a point is inside a Polygon or MultiPolygon geometry.

    A point in a hole of a polygon is outside.

    Parameters
    ----------
    x : float
        The longitude of the point.
    y : float
        The latitude of the point.
    geom : dict
        A GeoJSON geometry of type ``Polygon`` or ``MultiPolygon``.

    Returns
    -------
    bool
        True when the point is inside the geometry.

    Examples
    --------
    .. code-block:: python

        geom = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]}
        point_in_geom(1, 1, geom)  # True
    """
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        if point_in_ring(x, y, poly[0]) and not any(point_in_ring(x, y, h) for h in poly[1:]):
            return True
    return False


def make_find_quartier(quartier_geo: dict[str, Any]) -> Callable[[float, float, int], str | None]:
    """Return a function that finds the Quartier that contains a position.

    Parameters
    ----------
    quartier_geo : dict
        The Quartier boundaries as a GeoJSON feature collection. Each feature
        has the properties ``id`` and ``arr``.

    Returns
    -------
    callable
        ``find(lon, lat, arr)`` returns the Quartier id, or None when no
        Quartier contains the position.

    Examples
    --------
    .. code-block:: python

        find = make_find_quartier(quartier_geo)
        quartier = find(2.34567, 48.86123, 1)
    """
    by_arr: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for ft in quartier_geo["features"]:
        by_arr[ft["properties"]["arr"]].append(ft)

    def find(lon: float, lat: float, arr: int) -> str | None:
        # Quartiers are searched in the sale's arrondissement first, then everywhere
        # (coordinates close to a border can fall in the neighbouring arrondissement).
        for ft in by_arr[arr]:
            if point_in_geom(lon, lat, ft["geometry"]):
                return ft["properties"]["id"]
        for ft in quartier_geo["features"]:
            if point_in_geom(lon, lat, ft["geometry"]):
                return ft["properties"]["id"]
        return None

    return find


def classify_mutation(
    rows: list[dict[str, str]],
    find_quartier: Callable[[float, float, int], str | None],
) -> tuple[str, Sale | None]:
    """Decide whether one mutation counts as one residential Sale.

    The rules and their order are described in docs/adr/0004-sale-inclusion-rules.md.

    Parameters
    ----------
    rows : list of dict of str to str
        All DVF rows of one mutation, as ``csv.DictReader`` gives them.
    find_quartier : callable
        ``find(lon, lat, arr)`` returns the Quartier id or None. It receives
        the exact position.

    Returns
    -------
    tuple
        ``("kept", sale)`` for a Sale, or the name of the exclusion reason and
        None. The Sale holds the position rounded to three decimals and the
        street without the house number.

    Examples
    --------
    .. code-block:: python

        outcome, sale = classify_mutation(rows, find_quartier)
        if outcome == "kept":
            print(sale["pricePerSqm"])
    """
    if rows[0]["nature_mutation"] != "Vente":
        return "not_a_sale", None
    if any(r["type_local"] == "Local industriel. commercial ou assimilé" for r in rows):
        return "has_commercial_premises", None
    dw = [r for r in rows if r["type_local"] in DWELLINGS]
    if not dw:
        return "no_dwelling", None
    if len(dw) > 1:
        return "multiple_dwellings", None
    r = dw[0]
    try:
        price = float(r["valeur_fonciere"])
        surface = float(r["surface_reelle_bati"])
    except ValueError:
        return "missing_price_or_surface", None
    if not (MIN_PRICE <= price <= MAX_PRICE) or not (MIN_SURFACE <= surface <= MAX_SURFACE):
        return "out_of_range_price_or_surface", None
    ppsm = price / surface
    if not (MIN_PPSM <= ppsm <= MAX_PPSM):
        return "out_of_range_price_per_sqm", None
    arr = int(r["code_commune"]) - 75100
    if not 1 <= arr <= 20:
        return "bad_arrondissement", None
    lon = float(r["longitude"]) if r["longitude"] else None
    lat = float(r["latitude"]) if r["latitude"] else None
    # The Quartier comes from the exact position. Only then is the position rounded.
    quartier = find_quartier(lon, lat, arr) if lon is not None and lat is not None else None
    return "kept", {
        "id": r["id_mutation"],
        "date": r["date_mutation"],
        "type": r["type_local"],
        "price": round(price),
        "surface": round(surface),
        "pricePerSqm": round(ppsm),
        "rooms": int(r["nombre_pieces_principales"] or 0),
        "arr": arr,
        "quartier": quartier,
        "lon": round(lon, POSITION_DECIMALS) if lon is not None else None,
        "lat": round(lat, POSITION_DECIMALS) if lat is not None else None,
        # The house number and its suffix are dropped on purpose.
        "street": r["adresse_nom_voie"].title(),
    }


def check_columns(fieldnames: Sequence[str] | None) -> list[str]:
    """Find the expected DVF columns that the file does not have.

    Parameters
    ----------
    fieldnames : sequence of str or None
        The header of the CSV file, or None when the file is empty.

    Returns
    -------
    list of str
        The reasons for failure. The list is empty when every column is present.

    Examples
    --------
    .. code-block:: python

        reasons = check_columns(["id_mutation", "date_mutation"])
        # ["The file has no column valeur_fonciere, ..."]
    """
    if fieldnames is None:
        return ["The file has no header row."]
    missing = [c for c in EXPECTED_COLUMNS if c not in fieldnames]
    return [f"The file has no column {c}." for c in missing]


def read_previous(path: str) -> tuple[int, str] | None:
    """Read the Sale count and the end date of an existing Sales file.

    Parameters
    ----------
    path : str
        The DuckDB file written by ``write_database``.

    Returns
    -------
    tuple of (int, str) or None
        The number of Sales and the latest Sale date, or None when the file
        does not exist.

    Examples
    --------
    .. code-block:: python

        previous = read_previous("artifacts/api-server/data/sales.duckdb")
        # (62000, "2026-06-30")
    """
    if not os.path.exists(path):
        return None
    con = duckdb.connect(path, read_only=True)
    try:
        row = con.execute("SELECT count(*), max(sale_date) FROM sales").fetchone()
    finally:
        con.close()
    assert row is not None
    return row[0], row[1]


def check_release(
    sales: Sequence[Sale],
    previous: tuple[int, str] | None,
    arrondissements: Iterable[int],
    quartiers: Iterable[str],
) -> list[str]:
    """Decide whether a new release is safe to replace the existing file.

    The checks are: the release has Sales, every date is in ISO format, the
    Sale count is within ``MAX_COUNT_CHANGE`` of the previous count, every
    Arrondissement and Quartier has a Sale, and the end date is not earlier
    than the previous one.

    Parameters
    ----------
    sales : sequence of Sale
        The Sales of the new release.
    previous : tuple of (int, str) or None
        The Sale count and end date of the existing file, or None when there is none.
    arrondissements : iterable of int
        Every Arrondissement number of the boundary file.
    quartiers : iterable of str
        Every Quartier id of the boundary file.

    Returns
    -------
    list of str
        The reasons for failure. The list is empty on success.

    Examples
    --------
    .. code-block:: python

        reasons = check_release(sales, (62000, "2026-06-30"), range(1, 21), quartier_ids)
        if reasons:
            raise SystemExit("\\n".join(reasons))
    """
    if not sales:
        return ["No Sales: the file has no usable rows."]
    # A string comparison of dates is correct only for ISO dates, so check them first.
    bad_dates = sorted({s["date"] for s in sales if not _is_iso_date(s["date"])})
    if bad_dates:
        return [f"Dates not in YYYY-MM-DD format, for example {bad_dates[0]}."]
    reasons: list[str] = []
    end_date = max(s["date"] for s in sales)
    if previous is not None:
        count, previous_end = previous
        change = (len(sales) - count) / count
        if abs(change) > MAX_COUNT_CHANGE:
            reasons.append(
                f"Sale count changed by {change:+.1%} ({count} to {len(sales)}). "
                f"The limit is {MAX_COUNT_CHANGE:.0%}."
            )
        if end_date < previous_end:
            reasons.append(f"The end date {end_date} is earlier than the previous end date {previous_end}.")
    seen_arr = {s["arr"] for s in sales}
    seen_quartier = {s["quartier"] for s in sales}
    empty_arr = sorted(set(arrondissements) - seen_arr)
    if empty_arr:
        reasons.append(f"Arrondissements with no Sales: {', '.join(map(str, empty_arr))}.")
    empty_quartier = sorted(set(quartiers) - seen_quartier)
    if empty_quartier:
        reasons.append(f"Quartiers with no Sales: {', '.join(empty_quartier)}.")
    return reasons


def _is_iso_date(value: str) -> bool:
    """Tell whether a string is a valid ``YYYY-MM-DD`` date."""
    # Python 3.11 also reads forms such as 20260630 and 2026-W26-2, which sort wrongly.
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def write_database(sales: list[Sale], stats: Mapping[str, int], release_month: str, path: str) -> None:
    """Write the Sales and the exclusion counts to a DuckDB file.

    The data goes to ``<path>.part`` first and replaces ``path`` only after
    every row is loaded, so a failed run leaves an existing file unchanged.

    Parameters
    ----------
    sales : list of Sale
        The Sales to store. Their positions are already rounded. The list must not be empty.
    stats : mapping of str to int
        The number of mutations per outcome, such as ``kept``.
    release_month : str
        The month of the DVF release as ``YYYY-MM``. It goes to the metadata table.
    path : str
        Where to write the file.

    Examples
    --------
    .. code-block:: python

        write_database(sales, stats, "2026-10", "artifacts/api-server/data/sales.duckdb")
    """
    if not sales:
        raise ValueError("No Sales to write. The input has no usable rows, so the existing file stays unchanged.")
    part = f"{path}.part"
    folder = os.path.dirname(os.path.abspath(path))
    # The temporary CSV is in the target folder and holds only finished values.
    fd, csv_path = tempfile.mkstemp(suffix=".csv", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f, lineterminator="\n")
            for s in sales:
                writer.writerow(
                    [
                        s["id"], s["date"], s["type"], s["price"], s["surface"], s["pricePerSqm"],
                        s["rooms"], s["arr"], s["quartier"], s["lon"], s["lat"], s["street"],
                    ]
                )
        for leftover in (part, f"{part}.wal"):
            if os.path.exists(leftover):
                os.remove(leftover)
        con = duckdb.connect(part)
        try:
            con.execute(
                """CREATE TABLE sales (
                  id VARCHAR NOT NULL, sale_date VARCHAR NOT NULL, property_type VARCHAR NOT NULL,
                  price INTEGER NOT NULL, surface INTEGER NOT NULL, price_per_sqm INTEGER NOT NULL,
                  rooms INTEGER NOT NULL, arr INTEGER NOT NULL, quartier VARCHAR,
                  lon DOUBLE, lat DOUBLE, street VARCHAR NOT NULL
                )"""
            )
            con.execute("CREATE TABLE metadata (key VARCHAR NOT NULL, value VARCHAR NOT NULL)")
            con.execute("CREATE TABLE filter_counts (name VARCHAR NOT NULL, mutations INTEGER NOT NULL)")
            # The options keep an empty street from becoming NULL.
            con.execute(
                "COPY sales FROM ? (FORMAT csv, HEADER false, DELIM ',', QUOTE '\"', ESCAPE '\"', "
                "NULLSTR '', FORCE_NOT_NULL (street))",
                [csv_path],
            )
            con.execute("INSERT INTO metadata VALUES ('source', ?)", [SOURCE])
            con.execute("INSERT INTO metadata VALUES ('release_month', ?)", [release_month])
            con.executemany("INSERT INTO filter_counts VALUES (?, ?)", list(stats.items()))
        finally:
            con.close()
        os.replace(part, path)
    finally:
        for leftover in (csv_path, part, f"{part}.wal"):
            if os.path.exists(leftover):
                os.remove(leftover)


def main() -> None:
    """Build the Sales database and the boundary files.

    The function reads the boundaries, ``data-raw/src/paris.csv`` and
    ``data-raw/src/release.txt``, groups the rows by mutation, and keeps the
    mutations that count as one Sale. It checks the release against the
    existing file and exits with the reasons when a check fails. Only then does
    it write ``sales.duckdb`` and the two boundary GeoJSON files. It prints the
    exclusion counts and the period of the data.

    Examples
    --------
    .. code-block:: python

        main()
    """
    try:
        with open(os.path.join(RAW, "src", "release.txt"), encoding="utf-8") as f:
            release_month = f.read().strip()
    except FileNotFoundError:
        raise SystemExit("data-raw/src/release.txt is missing. Run scripts/fetch_dvf.py first.")
    arr_geo = load_geo(
        os.path.join(RAW, "arr.geojson"),
        lambda p: {"arr": int(p["c_ar"]), "name": p["l_aroff"]},
    )
    quartier_geo = load_geo(
        os.path.join(RAW, "q2.geojson"),
        lambda p: {"id": p["c_quinsee"], "name": p["l_qu"], "arr": int(p["c_ar"])},
    )
    find_quartier = make_find_quartier(quartier_geo)

    mutations: dict[str, list[dict[str, str]]] = defaultdict(list)
    with open(os.path.join(RAW, "src", "paris.csv"), encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        reasons = check_columns(reader.fieldnames)
        if reasons:
            raise SystemExit("\n".join(reasons))
        for row in reader:
            mutations[row["id_mutation"]].append(row)

    stats: dict[str, int] = defaultdict(int)
    sales: list[Sale] = []
    for rows in mutations.values():
        stats["mutations_total"] += 1
        outcome, sale = classify_mutation(rows, find_quartier)
        stats[outcome] += 1
        if sale is not None:
            sales.append(sale)

    db_path = os.path.join(OUT, "sales.duckdb")
    reasons = check_release(
        sales,
        read_previous(db_path),
        [ft["properties"]["arr"] for ft in arr_geo["features"]],
        [ft["properties"]["id"] for ft in quartier_geo["features"]],
    )
    if reasons:
        raise SystemExit("\n".join(reasons))

    sales.sort(key=lambda s: s["date"], reverse=True)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(BOUNDARIES, exist_ok=True)
    write_database(sales, stats, release_month, db_path)
    with open(os.path.join(BOUNDARIES, "arrondissements.geojson"), "w", encoding="utf-8") as f:
        json.dump(arr_geo, f, separators=(",", ":"))
    with open(os.path.join(BOUNDARIES, "quartiers.geojson"), "w", encoding="utf-8") as f:
        json.dump(quartier_geo, f, ensure_ascii=False, separators=(",", ":"))

    print(json.dumps(stats, indent=2))
    print(
        "period", min(s["date"] for s in sales), max(s["date"] for s in sales),
        "no-coords", sum(1 for s in sales if s["lon"] is None),
        "no-quartier", sum(1 for s in sales if s["lon"] is not None and s["quartier"] is None),
    )


if __name__ == "__main__":
    main()
