#!/usr/bin/env python3
"""Build the relief sources from the reviewed DEM, OSM snapshot and source geometry."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from relief.build import main
except ModuleNotFoundError as error:
    raise SystemExit(
        f'Missing build dependency {error.name}. Install data/tools/requirements.txt '
        'in the active Python environment.'
    ) from error


if __name__ == '__main__':
    raise SystemExit(main())
