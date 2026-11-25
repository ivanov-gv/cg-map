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
        'Validated {municipalities} municipalities, {unassigned_water} '
        'unassigned-water areas and {edges} shared edges; {areas} published '
        'polygons in total, with {settlements} settlements. Uncovered area '
        '{missing_area_sqm:.0f} m2, extra {extra_area_sqm:.0f} m2; neighbour '
        'overlap {neighbour_overlap_sqm:.0f} m2, inland gap '
        '{inland_gap_sqm:.0f} m2, inland ocean {inland_ocean_sqm:.0f} m2 '
        '(largest part {largest_inland_ocean_part_sqm:.0f} m2); '
        'new sources {combined_bytes} bytes.'.format(**metrics)
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
