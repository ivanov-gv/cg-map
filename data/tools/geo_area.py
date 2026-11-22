"""Local area conversions for reviewed Montenegro geography."""

from math import cos, radians

MONTENEGRO_MEAN_LATITUDE = 42.5
METRES_PER_DEGREE_LATITUDE = 111_132
METRES_PER_DEGREE_LONGITUDE_AT_EQUATOR = 111_320

# One degree of longitude is shorter at Montenegro's latitude than at the
# equator; this factor turns a WGS84 degree square into a local area.
SQUARE_DEGREES_TO_SQUARE_METRES = (
    METRES_PER_DEGREE_LATITUDE
    * METRES_PER_DEGREE_LONGITUDE_AT_EQUATOR
    * cos(radians(MONTENEGRO_MEAN_LATITUDE))
)

# Small areas are coordinate-rounding residue, not a mappable gap. The reviewed
# extract leaves about 14,700 m2 of coastline slivers after assignable gaps are
# filled, so the check allows a narrow margin above that measured residue.
MISSING_AREA_TOLERANCE_SQM = 20_000
EXTRA_AREA_TOLERANCE_SQM = 10_000
