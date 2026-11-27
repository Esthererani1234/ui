"""Build county-level exclusions from complete official resort boundary inventories."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from osgeo import ogr

LAYERS = {
    "designations": "https://services.arcgis.com/iTQUx5ZpNUh47Geb/arcgis/rest/services/Montana_Resort_Areas_and_Communities/FeatureServer/0",
    "districts": "https://gisservice.mt.gov/ArcGIS/rest/services/msdi_administrative_boundaries_map_v1/MapServer/51",
    "counties": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1",
}
HEBGEN = "https://hebgenbasinresorttax.org/wp-content/uploads/2025/09/Second-Reading-HBRRTD-Ordinance-25-01-Final-13.pdf"


def fetch(layer, params):
    req = Request(layer + "/query?" + urlencode(params), headers={"User-Agent": "GoldOnTheSpot tax research"})
    with urlopen(req, timeout=60) as response:
        return json.load(response)


def geometries(name, layer):
    where = "STATE='30'" if name == "counties" else "1=1"
    ids = fetch(layer, {"where": where, "f": "json", "returnIdsOnly": "true"})
    identity = ids["objectIdFieldName"]
    result = fetch(layer, {"where": where, "f": "geojson", "outFields": "*", "outSR": 4326, "returnGeometry": "true"})
    features = result["features"]
    if not features or result.get("exceededTransferLimit") or {f["properties"][identity] for f in features} != set(ids["objectIds"]):
        raise ValueError("Incomplete layer: " + name)
    return [(f["properties"], ogr.CreateGeometryFromJson(json.dumps(f["geometry"])).MakeValid()) for f in features]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reviewed_on")
    parser.add_argument("through")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    layers = {name: geometries(name, url) for name, url in LAYERS.items()}
    if len(layers["counties"]) != 56:
        raise ValueError("Review the Montana county inventory")
    resorts = layers["designations"] + layers["districts"]
    # The Hebgen ordinance covers part of Gallatin County. Exclude the entire
    # county even if one of the two state-maintained layers omits the district.
    outside = {}
    for county, boundary in layers["counties"]:
        code = county["GEOID"]
        if code != "30031" and all(boundary.Disjoint(area) for _, area in resorts):
            outside[code] = county["BASENAME"]
    if not outside or not resorts:
        raise ValueError("Empty inventory")
    payload = {"reviewed_on": args.reviewed_on, "through": args.through,
               "sources": list(LAYERS.values()) + [HEBGEN],
               "feature_counts": {key: len(value) for key, value in layers.items()},
               "outside": dict(sorted(outside.items()))}
    args.output.write_text(json.dumps(payload, indent=2) + "\n")


if __name__ == "__main__":
    main()
