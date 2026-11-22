"""Entry point for the OSM display extractor implemented in osm_extract."""

import sys
from pathlib import Path


def main():
    """Run the packaged CLI from its historical script path."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from osm_extract.cli import main as extract

    return extract()


if __name__ == '__main__':
    raise SystemExit(main())
