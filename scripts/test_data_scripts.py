# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.4.5"]
# ///
"""Tests for the data scripts.

Run: cd scripts && uv run test_data_scripts.py
"""
import csv
import io
import unittest

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


if __name__ == "__main__":
    unittest.main()
