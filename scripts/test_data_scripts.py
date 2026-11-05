# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb==1.4.5"]
# ///
"""Tests for the data scripts.

Run: cd scripts && uv run test_data_scripts.py
"""
import csv
import io
import os
import tempfile
import unittest
from typing import Any

import duckdb

from build_paris_sales import Sale, classify_mutation, write_database
from fetch_dvf import copy_paris_rows


class CopyParisRowsTest(unittest.TestCase):
    def test_copy_paris_rows_keeps_department_75_from_2022(self) -> None:
        header = ["id_mutation", "date_mutation", "code_departement", "adresse_nom_voie"]
        rows = [
            header,
            ["a", "2022-01-01", "75", 'RUE "X", Y'],
            ["b", "2021-12-31", "75", "RUE B"],
            ["c", "2024-05-01", "92", "RUE C"],
        ]
        out = io.StringIO()
        count = copy_paris_rows(iter(rows), csv.writer(out, lineterminator="\n"))
        self.assertEqual(count, 1)
        self.assertEqual(list(csv.reader(io.StringIO(out.getvalue()))), rows[:2])


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
    return sale  # type: ignore[return-value]


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
        write_database(sales, {"kept": 3}, self.path)
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
        write_database([make_sale()], {"kept": 1, "not_a_sale": 7}, self.path)
        self.assertEqual(self.read("SELECT key FROM metadata"), [("source",)])
        self.assertEqual(
            self.read("SELECT name, mutations FROM filter_counts ORDER BY name"),
            [("kept", 1), ("not_a_sale", 7)],
        )

    def test_overwrite_replaces_file_and_leaves_no_extra_files(self) -> None:
        write_database([make_sale(id="old")], {"kept": 1}, self.path)
        write_database([make_sale(id="new1"), make_sale(id="new2")], {"kept": 2}, self.path)
        self.assertEqual(self.read("SELECT id FROM sales ORDER BY id"), [("new1",), ("new2",)])
        self.assertEqual(os.listdir(self.dir.name), ["sales.duckdb"])

    def test_empty_sales_raise_and_keep_existing_file(self) -> None:
        write_database([make_sale(id="old")], {"kept": 1}, self.path)
        with self.assertRaises(ValueError):
            write_database([], {"kept": 0}, self.path)
        self.assertEqual(self.read("SELECT id FROM sales"), [("old",)])
        self.assertEqual(os.listdir(self.dir.name), ["sales.duckdb"])

    def test_failed_write_keeps_existing_file_and_leaves_no_extra_files(self) -> None:
        write_database([make_sale(id="old")], {"kept": 1}, self.path)
        with self.assertRaises(Exception):
            write_database([make_sale(price=None)], {"kept": 1}, self.path)
        self.assertEqual(self.read("SELECT id FROM sales"), [("old",)])
        self.assertEqual(os.listdir(self.dir.name), ["sales.duckdb"])


if __name__ == "__main__":
    unittest.main()
