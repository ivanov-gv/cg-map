"""Source identity shared by OSM layers and non-OSM source files."""

import hashlib
import json

IDENTITY_FIELDS = ('entityId', 'entityVersion', 'entityPart')


def make_feature(geometry, properties, identity, part=None):
    """Return a Feature with identity fields from the shared contract."""
    feature_properties = {**properties, **identity}
    if part is not None:
        feature_properties['entityPart'] = part
    return {
        'type': 'Feature',
        'geometry': geometry,
        'properties': feature_properties,
    }


def osm_identity(kind, osm_id, version):
    """Return identity for one typed OSM object and its upstream version."""
    if kind not in ('node', 'way', 'relation'):
        raise ValueError(f'unsupported OSM object kind: {kind}')
    if not isinstance(version, int) or version < 1:
        raise ValueError(
            f'OSM version must be a positive integer: {version}'
        )
    return {'entityId': f'{kind}/{osm_id}', 'entityVersion': version}


def content_version(value):
    """Return a stable base-revision token for an unversioned object."""
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(',', ':')
    ).encode('utf-8')
    return 'sha256:' + hashlib.sha256(encoded).hexdigest()


def feature_content_version(feature):
    """Hash geometry and domain properties, never an identity field."""
    properties = {
        name: value for name, value in feature['properties'].items()
        if name not in IDENTITY_FIELDS
    }
    return content_version({
        'geometry': feature['geometry'], 'properties': properties
    })


def adopt_collection(collection, identifier):
    """Add identity to a static source without changing domain properties."""
    features = []
    for feature in collection['features']:
        properties = feature['properties']
        already_adopted = (
            collection.get('entitySchemaVersion') == 1
            and properties.get('entityId')
            and properties.get('entityVersion')
        )
        identity = {
            'entityId': (
                properties.get('entityId') or identifier(feature)
            ),
            'entityVersion': (
                properties.get('entityVersion')
                or feature_content_version(feature)
            ),
        }
        if 'entityPart' in properties:
            identity['entityPart'] = properties['entityPart']
        if not already_adopted:
            identity['entityVersion'] = feature_content_version(feature)
        features.append({
            **feature, 'properties': {**properties, **identity}
        })
    return {
        'type': 'FeatureCollection',
        'entitySchemaVersion': 1,
        'features': features,
    }
