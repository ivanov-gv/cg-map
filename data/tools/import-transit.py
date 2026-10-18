"""Refresh representative bus patterns from the public ePodgorica API, not expired GTFS.

Patterns are not a service calendar or departure predictor. See docs/routing.md.
"""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BASE = 'https://adminapi.prevoz.podgorica.me/api/gtfs/'
CACHE = ROOT / '.build/transit-import'
CACHE.mkdir(parents=True, exist_ok=True)


def get(path):
    url = BASE + path
    target = CACHE / (hashlib.sha256(url.encode()).hexdigest() + '.json')
    if target.exists() and time.time() - target.stat().st_mtime < 3600:
        return json.loads(target.read_text())
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'cg-map transit snapshot importer'}), timeout=30) as response:
                data = json.load(response)
            if not isinstance(data, list):
                raise ValueError('Expected public API list')
            target.write_text(json.dumps(data))
            return data
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def seconds(value):
    h, m, s = map(int, value.split(':'))
    return h * 3600 + m * 60 + s


def main():
    routes = get('routes')
    jobs = [(route, day) for route in routes for day in ['Ponedjeljak', 'Subota', 'Nedjelja']]

    def trips(job):
        route, day = job
        return route, get('trips?' + urllib.parse.urlencode({'routeId': route['routeId'], 'dayOfWeek': day}))

    samples = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for route, rows in pool.map(trips, jobs):
            for trip in rows:
                # Distinct direction/headsign/stop count variants are sampled explicitly.
                key = (route['routeId'], trip['directionId'], trip.get('tripHeadSign', ''), len(trip.get('departureTimes', [])))
                samples.setdefault(key, (route, trip))
    print(f'{len(routes)} routes, {len(samples)} representative patterns', flush=True)
    stop_rows = get('stops/all')
    stops = {row['stopId']: {'name': row['stopName'], 'coordinates': [row['longitude'], row['latitude']]} for row in stop_rows}

    def pattern(sample):
        route, trip = sample
        rows = sorted(get('stops?' + urllib.parse.urlencode({'tripId': trip['tripId']})), key=lambda row: row['stopSequence'])
        if len(rows) < 2:
            return None
        times = [seconds(row['departureTime'] or row['arrivalTime']) for row in rows]
        if any(b < a for a, b in zip(times, times[1:])):
            raise ValueError('Non-monotonic representative trip')
        ids = [row['stopId'] for row in rows]
        if any(sid not in stops for sid in ids):
            raise ValueError('Trip references a missing stop')
        return {'route': route['routeShortName'], 'name': route['routeLongName'], 'headsign': trip.get('tripHeadSign', ''), 'sampleTrip': trip['tripId'], 'stops': ids, 'offsets': [t - times[0] for t in times]}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        patterns = [p for p in pool.map(pattern, samples.values()) if p]
    unique = {}
    for p in patterns:
        unique.setdefault((p['route'], tuple(p['stops'])), p)
    data = {'version': 1, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'source': 'https://epodgorica.me/javniprevoz/mapa', 'stops': stops, 'patterns': list(unique.values())}
    encoded = (json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    (ROOT / 'data/sources/transit-network.json').write_bytes(encoded)
    provenance = {'source': BASE, 'retrieved_at': data['retrievedAt'], 'bytes': len(encoded), 'sha256': hashlib.sha256(encoded).hexdigest(), 'stops': len(stops), 'patterns': len(unique), 'routes': len({p['route'] for p in unique.values()}), 'sampling': 'Representative direction/headsign/stop-count variants from Monday, Saturday and Sunday trips. Not a complete trip list or service calendar.', 'license': 'No explicit reuse license found; attribution retained.'}
    (ROOT / 'data/sources/transit-network.provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps(provenance), flush=True)


if __name__ == '__main__':
    main()
