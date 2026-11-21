"""Tag interpretation shared by OSM layer modules."""

PLACE_RANKS = {
    'city': 'city',
    'town': 'town',
    'village': 'village',
    'hamlet': 'village',
    'suburb': 'village',
    'quarter': 'village',
    'neighbourhood': 'village',
}


def population_value(tags):
    """Return a clean OSM population count, or nothing for other values."""
    value = tags.get('population', '')
    return int(value) if value.isdigit() else None


def rank_for(tags):
    """Normalise an OSM place tag to the editor's settlement rank."""
    if tags.get('capital') == 'yes':
        return 'capital'
    place = tags.get('place', '')
    if place not in PLACE_RANKS:
        raise ValueError(f'unsupported place tag: {place}')
    return PLACE_RANKS[place]
