"""Allow the extractor package to be run with python -m osm_extract."""

from .cli import main

if __name__ == '__main__':
    raise SystemExit(main())
