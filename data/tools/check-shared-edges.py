#!/usr/bin/env python3
"""Print the reviewed shared-border topology measurements."""

import argparse
from pathlib import Path

from shared_edge_checks import check_sources


def main():
    """Check the reviewed sources and print a short summary."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--root', type=Path,
        default=Path(__file__).resolve().parents[2],
        help='Repository root holding data/sources'
    )
    args = parser.parse_args()
    metrics = check_sources(args.root / 'data/sources')
    print(
        'Validated {municipalities} municipality polygons, {edges} shared '
        'edges and {settlements} settlements. Inland water gap '
        '{missing_area:.9f}, unexplained gap {unexplained_gap_area:.9f}, '
        'extra {extra_area:.9f} square degrees; new sources '
        '{combined_bytes} bytes.'.format(**metrics)
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
