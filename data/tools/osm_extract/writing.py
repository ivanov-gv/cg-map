"""Deterministic writing of source GeoJSON files."""

import json
import os


def canonical_number(value):
    """Match JavaScript JSON for integral floats from geometry libraries."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def canonical_value(value):
    """Normalise numbers before encoding, so Python and Node agree on bytes."""
    if isinstance(value, dict):
        return {
            name: canonical_value(item) for name, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [canonical_value(item) for item in value]
    return canonical_number(value)


def encoded_feature(feature):
    """Encode one feature with sorted keys and canonical numbers."""
    return json.dumps(
        canonical_value(feature), ensure_ascii=False, sort_keys=True,
        separators=(',', ':')
    )


def serialization_key(feature):
    """Order features by source entity, then part, then canonical JSON."""
    properties = feature['properties']
    part = properties.get('entityPart', -1)
    return properties['entityId'], part, encoded_feature(feature)


def serialize_collection(features):
    """Write one sorted, key-sorted feature per line for clean merges."""
    for feature in features:
        properties = feature['properties']
        if 'entityId' not in properties or 'entityVersion' not in properties:
            raise ValueError(f'feature has no source identity: {feature}')
    ordered = sorted(features, key=serialization_key)
    lines = [encoded_feature(feature) for feature in ordered]
    return (
        '{"entitySchemaVersion":1,"features":[\n'
        + ',\n'.join(lines)
        + '\n],"type":"FeatureCollection"}\n'
    )


def read_collection(path):
    """Read a collection that may still use the historical single-line form."""
    return json.loads(path.read_text(encoding='utf-8'))


def write_collection(path, features):
    """Replace one source atomically, so a failed write cannot truncate it."""
    text = serialize_collection(features)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'{path.name}.new')
    temporary.write_text(text, encoding='utf-8')
    os.replace(temporary, path)
