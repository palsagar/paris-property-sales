# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb==1.4.5"]
# ///
"""Tests for the data scripts.

Run: cd scripts && uv run test_data_scripts.py
"""
import contextlib
import csv
import io
import json
import os
import tempfile
import unittest
from typing import Any
from unittest import mock

import build_paris_sales
import duckdb
import fetch_communes
from build_paris_sales import (
    EXPECTED_COLUMNS,
    Sale,
    check_columns,
    check_release,
    classify_mutation,
    main,
    write_database,
)
from communes import (
    COMMUNE_CODES,
    DEPARTMENT_COMMUNES,
    MAJOR_TOWNS,
    commune_group,
    current_code,
)
from fetch_communes import keep_communes
from fetch_dvf import copy_department_rows, find_release


class CommuneListTest(unittest.TestCase):
    def test_list_holds_exactly_the_135_communes(self) -> None:
        self.assertEqual({d: len(c) for d, c in DEPARTMENT_COMMUNES.items()}, {"92": 36, "93": 39, "94": 47})
        self.assertEqual(len(MAJOR_TOWNS), 13)
        self.assertEqual(len(set(COMMUNE_CODES)), 135)

    def test_old_code_maps_to_the_current_one(self) -> None:
        self.assertEqual(current_code("93059"), "93066")
        self.assertEqual(current_code("92012"), "92012")
        self.assertNotIn("93059", COMMUNE_CODES)

    def test_group_of_a_commune(self) -> None:
        self.assertEqual(commune_group("93066"), "93")
        self.assertEqual(commune_group("78646"), "major")


class CopyDepartmentRowsTest(unittest.TestCase):
    def test_copy_department_rows_keeps_the_departments_of_the_communes_and_paris(self) -> None:
        header = ["id_mutation", "date_mutation", "code_departement", "adresse_nom_voie"]
        rows = [
            header,
            ["a", "2022-01-01", "75", 'RUE "X", Y'],
            ["b", "2021-12-31", "92", "RUE B"],
            ["c", "2024-05-01", "60", "RUE C"],
            ["d", "2024-05-02", "77", "RUE D"],
        ]
        out = io.StringIO()
        count = copy_department_rows(iter(rows), csv.writer(out, lineterminator="\n"))
        self.assertEqual(count, 3)
        self.assertEqual(list(csv.reader(io.StringIO(out.getvalue()))), [rows[0], rows[1], rows[2], rows[4]])


class KeepCommunesTest(unittest.TestCase):
    @staticmethod
    def feature(code: str) -> dict[str, Any]:
        return {"type": "Feature", "properties": {"code": code},
                "geometry": {"type": "Polygon", "coordinates": [[[2, 48], [2, 49], [3, 49], [2, 48]]]}}

    def test_keeps_only_the_listed_communes_with_their_geometry(self) -> None:
        collection = {"type": "FeatureCollection",
                      "features": [self.feature("92012"), self.feature("78646"), self.feature("69123")]}
        with mock.patch.object(fetch_communes, "COMMUNE_CODES", ("92012", "78646")):
            kept = keep_communes(collection)
        self.assertEqual([f["properties"]["code"] for f in kept["features"]], ["92012", "78646"])
        self.assertEqual(kept["features"][0]["geometry"], self.feature("92012")["geometry"])

    def test_raises_when_a_listed_commune_is_missing(self) -> None:
        collection = {"type": "FeatureCollection", "features": [self.feature("92012")]}
        with mock.patch.object(fetch_communes, "COMMUNE_CODES", ("92012", "78646")):
            with self.assertRaisesRegex(ValueError, "78646"):
                keep_communes(collection)


class FindReleaseTest(unittest.TestCase):
    single = {"title": "DVF juillet 2021 - juin 2026 - fichier unique",
              "url": "https://example.org/dvf.csv.gz", "last_modified": "2026-10-21T08:58:04.821000+00:00"}
    others = [{"title": "DVF 2022", "url": "https://example.org/2022.csv.gz", "last_modified": "2026-10-20T11:42:30+00:00"}]

    def test_returns_url_and_release_month(self) -> None:
        self.assertEqual(find_release({"resources": [*self.others, self.single]}),
                         ("https://example.org/dvf.csv.gz", "2026-10"))

    def test_title_match_ignores_case(self) -> None:
        upper = {**self.single, "title": "DVF - Fichier Unique"}
        self.assertEqual(find_release({"resources": [upper]})[1], "2026-10")

    def test_no_match_raises_and_names_the_titles(self) -> None:
        with self.assertRaisesRegex(ValueError, "DVF 2022"):
            find_release({"resources": self.others})

    def test_two_matches_raise(self) -> None:
        with self.assertRaisesRegex(ValueError, "fichier unique"):
            find_release({"resources": [self.single, self.single]})

    def test_bad_modified_date_raises(self) -> None:
        with self.assertRaises(ValueError):
            find_release({"resources": [{**self.single, "last_modified": "soon"}]})

    def test_resource_without_last_modified_raises_and_names_the_field(self) -> None:
        without = {k: v for k, v in self.single.items() if k != "last_modified"}
        with self.assertRaisesRegex(ValueError, "last_modified"):
            find_release({"resources": [without]})

    def test_dataset_without_resources_raises_and_names_the_field(self) -> None:
        with self.assertRaisesRegex(ValueError, "resources"):
            find_release({})


def mutation_row(**overrides: str) -> dict[str, str]:
    """Return one valid invented DVF row for an apartment.

    Parameters
    ----------
    **overrides : str
        Column values that replace the defaults.

    Returns
    -------
    dict of str to str
        A row as ``csv.DictReader`` gives it, with every value a string.

    Examples
    --------
    .. code-block:: rst

        .. code-block:: python

            row = mutation_row(valeur_fonciere="250000")
    """
    row = {
        "id_mutation": "2026-1",
        "date_mutation": "2026-03-15",
        "nature_mutation": "Vente",
        "valeur_fonciere": "200000",
        "code_commune": "75101",
        "adresse_numero": "12",
        "adresse_suffixe": "B",
        "adresse_nom_voie": "RUE DE RIVOLI",
        "type_local": "Appartement",
        "surface_reelle_bati": "50",
        "nombre_pieces_principales": "2",
        "longitude": "2.34567",
        "latitude": "48.86123",
    }
    row.update(overrides)
    return row


def no_quartier(lon: float, lat: float, arr: int) -> str | None:
    """Stand in for the quartier lookup in tests that ignore the quartier."""
    return None


def money(price: int, surface: int) -> dict[str, str]:
    """Return the price and Built surface overrides for ``mutation_row``."""
    return {"valeur_fonciere": str(price), "surface_reelle_bati": str(surface)}


class ClassifyMutationTest(unittest.TestCase):
    def test_each_rule_gives_its_outcome(self) -> None:
        shop = mutation_row(type_local="Local industriel. commercial ou assimilé")
        cases: list[tuple[str, list[dict[str, str]], str]] = [
            ("echange", [mutation_row(nature_mutation="Echange")], "not_a_sale"),
            ("commercial premises", [mutation_row(), shop], "has_commercial_premises"),
            ("only a dependency", [mutation_row(type_local="Dépendance")], "no_dwelling"),
            ("two apartments", [mutation_row(), mutation_row()], "multiple_dwellings"),
            ("blank price", [mutation_row(valeur_fonciere="")], "missing_price_or_surface"),
            ("blank surface", [mutation_row(surface_reelle_bati="")], "missing_price_or_surface"),
            ("price 19,999", [mutation_row(**money(19_999, 9))], "out_of_range_price_or_surface"),
            ("price 20,000", [mutation_row(**money(20_000, 9))], "kept"),
            ("price 20,000,001", [mutation_row(**money(20_000_001, 300))], "out_of_range_price_or_surface"),
            ("price 20,000,000", [mutation_row(**money(20_000_000, 300))], "out_of_range_price_per_sqm"),
            ("surface 8", [mutation_row(**money(100_000, 8))], "out_of_range_price_or_surface"),
            ("surface 301", [mutation_row(**money(1_000_000, 301))], "out_of_range_price_or_surface"),
            ("surface 300", [mutation_row(**money(1_000_000, 300))], "kept"),
            ("2,000 less 1 EUR/m2", [mutation_row(**money(99_999, 50))], "out_of_range_price_per_sqm"),
            ("exactly 2,000 EUR/m2", [mutation_row(**money(100_000, 50))], "kept"),
            ("exactly 35,000 EUR/m2", [mutation_row(**money(1_750_000, 50))], "kept"),
            ("35,000 plus 1 EUR/m2", [mutation_row(**money(1_750_001, 50))], "out_of_range_price_per_sqm"),
            ("commune 75121", [mutation_row(code_commune="75121")], "bad_arrondissement"),
        ]
        for name, rows, expected in cases:
            with self.subTest(name):
                outcome, sale = classify_mutation(rows, no_quartier)
                self.assertEqual(outcome, expected)
                self.assertEqual(sale is not None, expected == "kept")

    def test_quartier_uses_exact_position_and_sale_keeps_only_rounded_one(self) -> None:
        seen: list[tuple[float, float, int]] = []

        def find(lon: float, lat: float, arr: int) -> str:
            seen.append((lon, lat, arr))
            return "7510101"

        outcome, sale = classify_mutation([mutation_row()], find)
        self.assertEqual(seen, [(2.34567, 48.86123, 1)])
        self.assertIsNotNone(sale)
        assert sale is not None
        self.assertEqual(
            (outcome, sale["quartier"], sale["lon"], sale["lat"]),
            ("kept", "7510101", 2.346, 48.861),
        )
        self.assertEqual(sale["street"], "Rue De Rivoli")

    def test_blank_position_gives_no_quartier_and_skips_the_lookup(self) -> None:
        def find(lon: float, lat: float, arr: int) -> str:
            raise AssertionError("find must not be called")

        _, sale = classify_mutation([mutation_row(longitude="", latitude="")], find)
        assert sale is not None
        self.assertEqual((sale["lon"], sale["lat"], sale["quartier"]), (None, None, None))

    def test_blank_room_count_gives_zero_rooms(self) -> None:
        _, sale = classify_mutation([mutation_row(nombre_pieces_principales="")], no_quartier)
        assert sale is not None
        self.assertEqual(sale["rooms"], 0)


def make_sale(**overrides: Any) -> Sale:
    """Return one valid Sale, with ``overrides`` replacing the defaults."""
    sale: dict[str, Any] = {
        "id": "2026-1",
        "date": "2026-03-15",
        "type": "Appartement",
        "price": 200_000,
        "surface": 50,
        "pricePerSqm": 4_000,
        "rooms": 2,
        "arr": 1,
        "quartier": "7510101",
        "lon": 2.346,
        "lat": 48.861,
        "street": "Rue De Rivoli",
    }
    sale.update(overrides)
    return sale


class WriteDatabaseTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, "sales.duckdb")

    def read(self, query: str) -> list[tuple[Any, ...]]:
        con = duckdb.connect(self.path, read_only=True)
        try:
            return con.execute(query).fetchall()
        finally:
            con.close()

    def test_round_trip_keeps_values_exactly(self) -> None:
        sales = [
            make_sale(id="a", street='Rue "Du, Test" Été'),
            make_sale(id="b", street=""),
            make_sale(id="c", quartier=None, lon=None, lat=None),
        ]
        write_database(sales, {"kept": 3}, "2026-10", self.path)
        rows = self.read(
            "SELECT id, sale_date, property_type, price, surface, price_per_sqm, rooms, arr,"
            " quartier, lon, lat, street FROM sales ORDER BY id"
        )
        expected = [
            (s["id"], s["date"], s["type"], s["price"], s["surface"], s["pricePerSqm"], s["rooms"],
             s["arr"], s["quartier"], s["lon"], s["lat"], s["street"])
            for s in sales
        ]
        self.assertEqual(rows, expected)
        self.assertEqual(rows[1][-1], "")

    def test_metadata_and_filter_counts_hold_what_was_passed_in(self) -> None:
        write_database([make_sale()], {"kept": 1, "not_a_sale": 7}, "2026-10", self.path)
        self.assertEqual(
            self.read("SELECT key, value FROM metadata WHERE key = 'release_month'"),
            [("release_month", "2026-10")],
        )
        self.assertEqual(
            self.read("SELECT name, mutations FROM filter_counts ORDER BY name"),
            [("kept", 1), ("not_a_sale", 7)],
        )

    def test_overwrite_replaces_file_and_leaves_no_extra_files(self) -> None:
        write_database([make_sale(id="old")], {"kept": 1}, "2026-10", self.path)
        write_database([make_sale(id="new1"), make_sale(id="new2")], {"kept": 2}, "2026-10", self.path)
        self.assertEqual(self.read("SELECT id FROM sales ORDER BY id"), [("new1",), ("new2",)])
        self.assertEqual(os.listdir(self.dir.name), ["sales.duckdb"])

    def test_empty_sales_raise_and_keep_existing_file(self) -> None:
        write_database([make_sale(id="old")], {"kept": 1}, "2026-10", self.path)
        with self.assertRaises(ValueError):
            write_database([], {"kept": 0}, "2026-10", self.path)
        self.assertEqual(self.read("SELECT id FROM sales"), [("old",)])
        self.assertEqual(os.listdir(self.dir.name), ["sales.duckdb"])

    def test_failed_write_keeps_existing_file_and_leaves_no_extra_files(self) -> None:
        write_database([make_sale(id="old")], {"kept": 1}, "2026-10", self.path)
        with self.assertRaises(Exception):
            write_database([make_sale(price=None)], {"kept": 1}, "2026-10", self.path)
        self.assertEqual(self.read("SELECT id FROM sales"), [("old",)])
        self.assertEqual(os.listdir(self.dir.name), ["sales.duckdb"])


class CheckReleaseTest(unittest.TestCase):
    good = [make_sale(id=str(i), date="2026-06-30", arr=1, quartier="7510101") for i in range(100)]

    def check(self, sales: list[Sale], previous: tuple[int, str] | None = (100, "2026-06-30"),
              arrs: tuple[int, ...] = (1,), quartiers: tuple[str, ...] = ("7510101",),
              release_month: str = "2026-10") -> list[str]:
        return check_release(sales, previous, arrs, quartiers, release_month)

    def test_passes_on_same_release_again_and_on_no_previous_file(self) -> None:
        self.assertEqual(self.check(self.good), [])
        self.assertEqual(self.check(self.good, previous=None), [])

    def test_count_limit_is_15_percent_in_both_directions(self) -> None:
        self.assertEqual(self.check(self.good, previous=(115, "2026-06-30")), [])  # -13.0%
        self.assertEqual(self.check(self.good[:85]), [])                           # exactly -15%
        self.assertIn("Sale count", self.check(self.good[:84])[0])                 # -16%
        self.assertIn("Sale count", self.check(self.good * 2)[0])                  # +100%

    def test_area_with_no_sales_is_named(self) -> None:
        self.assertIn("20", self.check(self.good, arrs=(1, 20))[0])
        self.assertIn("7510102", self.check(self.good, quartiers=("7510101", "7510102"))[0])

    def test_end_date_earlier_than_previous_fails(self) -> None:
        self.assertIn("end date", self.check(self.good, previous=(100, "2026-12-31"))[0])

    def test_date_not_in_iso_format_fails(self) -> None:
        bad = [*self.good[:99], make_sale(date="30/06/2026", arr=1, quartier="7510101")]
        self.assertIn("30/06/2026", self.check(bad)[0])

    def test_dates_that_sort_wrongly_or_do_not_exist_fail(self) -> None:
        # Python 3.11 reads the first two as valid dates, but the site reads dates by character position.
        for value in ("20260630", "2026-W26-2", "2026-13-45"):
            with self.subTest(value=value):
                bad = [*self.good[:99], make_sale(date=value, arr=1, quartier="7510101")]
                self.assertIn(value, self.check(bad)[0])

    def test_sale_dated_after_the_release_month_fails(self) -> None:
        def with_date(value: str) -> list[Sale]:
            return [*self.good[:99], make_sale(date=value, arr=1, quartier="7510101")]

        reasons = self.check(with_date("2096-06-30"))
        self.assertIn("2096-06-30", reasons[0])
        self.assertIn("2026-10", reasons[0])
        self.assertEqual(self.check(with_date("2026-10-31")), [])  # last day of the release month
        self.assertIn("2026-11-01", self.check(with_date("2026-11-01"))[0])
        # A fresh clone has no previous file, and the check must still run.
        self.assertIn("2096-06-30", self.check(with_date("2096-06-30"), previous=None)[0])

    def test_no_sales_fails_with_a_reason_and_no_previous_file(self) -> None:
        self.assertIn("No Sales", self.check([], previous=None)[0])


class CheckColumnsTest(unittest.TestCase):
    def test_names_missing_columns(self) -> None:
        columns = [c for c in EXPECTED_COLUMNS if c != "valeur_fonciere"]
        self.assertEqual(check_columns(EXPECTED_COLUMNS), [])
        self.assertIn("valeur_fonciere", check_columns(columns)[0])
        self.assertTrue(check_columns(None))


def square(lon: float, lat: float) -> dict[str, Any]:
    """Return a small invented Polygon around a position."""
    d = 0.01
    ring = [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]
    return {"type": "Polygon", "coordinates": [ring]}


NO_PREVIOUS_NOTICE = "No previous sales.duckdb, so the Sale count and end date checks did not run."


class MainTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.raw = os.path.join(self.dir.name, "raw")
        self.out = os.path.join(self.dir.name, "out")
        self.boundaries = os.path.join(self.dir.name, "boundaries")
        for folder in (os.path.join(self.raw, "src"), self.out, self.boundaries):
            os.makedirs(folder)
        self.db = os.path.join(self.out, "sales.duckdb")
        for name, value in (("RAW", self.raw), ("OUT", self.out), ("BOUNDARIES", self.boundaries)):
            patcher = mock.patch.object(build_paris_sales, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def write_inputs(self, count: int = 10, date: str = "2026-03-15", arrs: tuple[int, ...] = (1,),
                     drop_column: str | None = None, release: str | None = "2026-10") -> None:
        """Write invented inputs: ``count`` Sales in Arrondissement 1, one square per Arrondissement."""
        def write_json(name: str, features: list[dict[str, Any]]) -> None:
            with open(os.path.join(self.raw, name), "w", encoding="utf-8") as f:
                json.dump({"type": "FeatureCollection", "features": features}, f)

        write_json("arr.geojson", [
            {"type": "Feature", "properties": {"c_ar": a, "l_aroff": f"Arr {a}"},
             "geometry": square(2.34567 + a, 48.86123)} for a in arrs
        ])
        write_json("q2.geojson", [
            {"type": "Feature", "properties": {"c_quinsee": f"75{a:02d}01", "l_qu": f"Quartier {a}", "c_ar": a},
             "geometry": square(2.34567 + a, 48.86123)} for a in arrs
        ])
        columns = [c for c in mutation_row() if c != drop_column]
        with open(os.path.join(self.raw, "src", "paris.csv"), "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, columns, extrasaction="ignore")
            writer.writeheader()
            for i in range(count):
                # Arrondissement 1 sits at longitude 2.34567 + 1, so the position is shifted to match.
                writer.writerow(mutation_row(id_mutation=f"new{i}", date_mutation=date, longitude="3.34567"))
        if release is not None:
            with open(os.path.join(self.raw, "src", "release.txt"), "w", encoding="utf-8") as f:
                f.write(release)

    def write_previous(self) -> None:
        write_database([make_sale(id=f"old{i}") for i in range(10)], {"kept": 10}, "2026-04", self.db)

    def ids(self) -> list[tuple[Any, ...]]:
        con = duckdb.connect(self.db, read_only=True)
        try:
            return con.execute("SELECT id FROM sales ORDER BY id").fetchall()
        finally:
            con.close()

    def run_main(self) -> str:
        """Run ``main`` and return what it printed."""
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            main()
        return output.getvalue()

    def test_fresh_clone_builds_and_records_the_release_month(self) -> None:
        self.write_inputs()
        output = self.run_main()
        self.assertIn(NO_PREVIOUS_NOTICE, output)
        con = duckdb.connect(self.db, read_only=True)
        try:
            self.assertEqual(con.execute("SELECT count(*) FROM sales").fetchone(), (10,))
            self.assertEqual(
                con.execute("SELECT value FROM metadata WHERE key = 'release_month'").fetchall(), [("2026-10",)]
            )
        finally:
            con.close()
        self.assertEqual(sorted(os.listdir(self.boundaries)), ["arrondissements.geojson", "quartiers.geojson"])

    def test_rebuild_does_not_print_the_no_previous_file_line(self) -> None:
        self.write_previous()
        self.write_inputs()
        self.assertNotIn(NO_PREVIOUS_NOTICE, self.run_main())

    def test_each_failing_input_exits_and_keeps_the_previous_file(self) -> None:
        cases: list[tuple[str, dict[str, Any], str]] = [
            ("missing column", {"drop_column": "valeur_fonciere"}, "valeur_fonciere"),
            ("count more than 15% away", {"count": 5}, "Sale count"),
            ("Arrondissement with no Sales", {"arrs": (1, 2)}, "Arrondissement"),
            ("earlier end date", {"date": "2026-01-01"}, "end date"),
            ("Sale dated after the release month", {"date": "2096-06-30"}, "2096-06-30"),
            ("header with no rows", {"count": 0}, "No Sales"),
        ]
        for name, inputs, reason in cases:
            with self.subTest(name):
                self.write_previous()
                self.write_inputs(**inputs)
                with self.assertRaises(SystemExit) as raised:
                    self.run_main()
                self.assertIsInstance(raised.exception.code, str)
                self.assertIn(reason, str(raised.exception.code))
                self.assertEqual(self.ids(), [(f"old{i}",) for i in range(10)])
                self.assertEqual(os.listdir(self.out), ["sales.duckdb"])
                self.assertEqual(os.listdir(self.boundaries), [])

    def test_missing_release_file_exits_with_a_reason(self) -> None:
        self.write_inputs(release=None)
        with self.assertRaises(SystemExit) as raised:
            self.run_main()
        self.assertIn("fetch_dvf.py", str(raised.exception.code))
        self.assertEqual(os.listdir(self.out), [])


if __name__ == "__main__":
    unittest.main()
