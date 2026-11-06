# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb==1.4.5"]
# ///
"""Updates the Sales data in one step: download the DVF release, then build the file.

The build checks the release first and keeps the existing file when a check fails.
Both scripts also run alone, so a rebuild does not need another 610 MB download.

Run: uv run scripts/update_data.py
"""
import build_paris_sales
import fetch_dvf


def main() -> None:
    """Run ``fetch_dvf.main()`` and then ``build_paris_sales.main()``.

    Either step can exit with a reason. When the download fails, the build
    does not start. When the build rejects the release, the existing
    ``sales.duckdb`` stays in place.

    Examples
    --------
    .. code-block:: python

        main()
    """
    fetch_dvf.main()
    build_paris_sales.main()


if __name__ == "__main__":
    main()
