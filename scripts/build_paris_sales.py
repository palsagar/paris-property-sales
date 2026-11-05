"""Builds the cleaned Paris residential sales dataset (2022 to 2026 S1) used by the API server.

Source: DVF géolocalisées (data.gouv.fr), yearly files filtered to department 75.
Inputs (in data-raw/, not committed): src/paris-*.csv, arr.geojson, q2.geojson
Outputs (in artifacts/api-server/data/): paris-sales.json, arrondissements.geojson, quartiers.geojson

Run: python3 scripts/build_paris_sales.py
"""
import csv
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data-raw")
OUT = os.path.join(ROOT, "artifacts", "api-server", "data")
os.makedirs(OUT, exist_ok=True)

DWELLINGS = ("Appartement", "Maison")
MIN_PRICE, MAX_PRICE = 20_000, 20_000_000
MIN_SURFACE, MAX_SURFACE = 9, 300
MIN_PPSM, MAX_PPSM = 2_000, 35_000


def round_coords(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], 5), round(c[1], 5)]
    return [round_coords(x) for x in c]


def load_geo(path, keep):
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


arr_geo = load_geo(
    os.path.join(RAW, "arr.geojson"),
    lambda p: {"arr": int(p["c_ar"]), "name": p["l_aroff"]},
)
quartier_geo = load_geo(
    os.path.join(RAW, "q2.geojson"),
    lambda p: {"id": p["c_quinsee"], "name": p["l_qu"], "arr": int(p["c_ar"])},
)


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_geom(x, y, geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        if point_in_ring(x, y, poly[0]) and not any(point_in_ring(x, y, h) for h in poly[1:]):
            return True
    return False


QUARTIERS_BY_ARR = defaultdict(list)
for _ft in quartier_geo["features"]:
    QUARTIERS_BY_ARR[_ft["properties"]["arr"]].append(_ft)


def find_quartier(lon, lat, arr):
    # Quartiers are searched in the sale's arrondissement first, then everywhere
    # (coordinates close to a border can fall in the neighbouring arrondissement).
    for ft in QUARTIERS_BY_ARR[arr]:
        if point_in_geom(lon, lat, ft["geometry"]):
            return ft["properties"]["id"]
    for ft in quartier_geo["features"]:
        if point_in_geom(lon, lat, ft["geometry"]):
            return ft["properties"]["id"]
    return None


mutations = defaultdict(list)
src_dir = os.path.join(RAW, "src")
for name in sorted(os.listdir(src_dir)):
    if not (name.startswith("paris-") and name.endswith(".csv")):
        continue
    with open(os.path.join(src_dir, name), encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            mutations[row["id_mutation"]].append(row)

stats = defaultdict(int)
sales = []
for mid, rows in mutations.items():
    stats["mutations_total"] += 1
    if rows[0]["nature_mutation"] != "Vente":
        stats["not_a_sale"] += 1
        continue
    if any(r["type_local"] == "Local industriel. commercial ou assimilé" for r in rows):
        stats["has_commercial_premises"] += 1
        continue
    dw = [r for r in rows if r["type_local"] in DWELLINGS]
    if not dw:
        stats["no_dwelling"] += 1
        continue
    if len(dw) > 1:
        stats["multiple_dwellings"] += 1
        continue
    r = dw[0]
    try:
        price = float(r["valeur_fonciere"])
        surface = float(r["surface_reelle_bati"])
    except ValueError:
        stats["missing_price_or_surface"] += 1
        continue
    if not (MIN_PRICE <= price <= MAX_PRICE) or not (MIN_SURFACE <= surface <= MAX_SURFACE):
        stats["out_of_range_price_or_surface"] += 1
        continue
    ppsm = price / surface
    if not (MIN_PPSM <= ppsm <= MAX_PPSM):
        stats["out_of_range_price_per_sqm"] += 1
        continue
    arr = int(r["code_commune"]) - 75100
    if not 1 <= arr <= 20:
        stats["bad_arrondissement"] += 1
        continue
    lon = float(r["longitude"]) if r["longitude"] else None
    lat = float(r["latitude"]) if r["latitude"] else None
    quartier = find_quartier(lon, lat, arr) if lon is not None else None
    address = " ".join(x for x in [r["adresse_numero"], r["adresse_suffixe"], r["adresse_nom_voie"].title()] if x)
    sales.append(
        {
            "id": mid,
            "date": r["date_mutation"],
            "type": r["type_local"],
            "price": round(price),
            "surface": round(surface),
            "pricePerSqm": round(ppsm),
            "rooms": int(r["nombre_pieces_principales"] or 0),
            "arr": arr,
            "quartier": quartier,
            "lon": round(lon, 5) if lon is not None else None,
            "lat": round(lat, 5) if lat is not None else None,
            "address": address,
        }
    )
    stats["kept"] += 1

sales.sort(key=lambda s: s["date"], reverse=True)
out = {
    "source": "DVF géolocalisées, data.gouv.fr (DGFiP / Etalab)",
    "period": {"from": min(s["date"] for s in sales), "to": max(s["date"] for s in sales)},
    "filters": stats,
    "sales": sales,
}
with open(os.path.join(OUT, "paris-sales.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(OUT, "arrondissements.geojson"), "w", encoding="utf-8") as f:
    json.dump(arr_geo, f, separators=(",", ":"))
with open(os.path.join(OUT, "quartiers.geojson"), "w", encoding="utf-8") as f:
    json.dump(quartier_geo, f, ensure_ascii=False, separators=(",", ":"))

print(json.dumps(stats, indent=2))
print("period", out["period"], "no-coords", sum(1 for s in sales if s["lon"] is None), "no-quartier", sum(1 for s in sales if s["lon"] is not None and s["quartier"] is None))
