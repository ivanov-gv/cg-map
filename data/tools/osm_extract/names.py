"""OSM name fields shared by extracted layers."""


NAME_TAGS = ('name', 'name:en')


def copy_name_tags(tags):
    """Copy mapped names, omitting tags that are absent or blank."""
    return {
        tag: tags[tag] for tag in NAME_TAGS
        if isinstance(tags.get(tag), str) and tags[tag].strip()
    }
