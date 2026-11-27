"""Import a reviewed ARSSTC non-ZIP monthly workbook and official Census identity files."""
import argparse
from datetime import datetime
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

from openpyxl import load_workbook


def cents(value):
    return int(Decimal(str(value)) * 100)


def ppm(value):
    return int((Decimal(str(value)) * 1000000).to_integral_exact())


def name(value):
    return value.strip().split(",")[0].removesuffix(" City").replace("Saint Paul", "St. Paul").strip()


def effective(value):
    return value.date().isoformat() if isinstance(value, datetime) else datetime.strptime(value, "%m/%d/%Y").date().isoformat()


def census(path):
    data = json.loads(path.read_text())
    if data.get("exceededTransferLimit") or not data.get("features"):
        raise ValueError("Census inventory incomplete")
    return {f["attributes"]["BASENAME"]: f["attributes"]["GEOID"] for f in data["features"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ["workbook", "counties", "places", "output"]:
        parser.add_argument(key, type=Path)
    for key in ["source", "reviewed_on", "through"]:
        parser.add_argument(key)
    args = parser.parse_args()
    if not args.source.startswith("https://arsstc.org/wp-content/uploads/"):
        raise ValueError("Expected the Commission's published workbook")
    workbook = load_workbook(args.workbook, data_only=True, read_only=True)
    counties, places = census(args.counties), census(args.places)
    caps = {}
    for locale, flag, title, base, _, source in workbook["Tax Caps"].values:
        if flag not in ("Y", "N") or not title:
            continue
        term = {"Is there a sales tax cap on a single item?": "per_item",
                "Is there a sales tax cap on a transaction?": "per_transaction"}.get(title.strip())
        if not term:
            continue
        key = name(locale)
        entry = caps.setdefault(key, {})
        if term in entry:
            raise ValueError("Duplicate " + key + " cap")
        entry[term] = {"limit_cents": None if flag == "N" else cents(base), "source": source}
    entries = []
    for row in workbook["General Remote Sales Tax"].values:
        region, borough_rate, borough_code, _, borough_start, borough_from, city, city_rate, city_code, _, city_start, city_from, total = row[:13]
        if not isinstance(total, (int, float)):
            continue
        county = name(region).split(" Borough")[0].removesuffix(" Census Tract").replace("Fairbanks North Start", "Fairbanks North Star")
        place = name(city) if city else None
        parts = []
        for level, code, rate, start, first, caption in [
            ("county", borough_code, borough_rate, borough_start, borough_from, name(region)),
            ("city", city_code, city_rate, city_start, city_from, place),
        ]:
            if code is None:
                continue
            cap_key = "Haines Borough" if county == "Haines" else caption
            parts.append({"level": level, "code": str(code), "name": caption, "ppm": ppm(rate),
                          "collection_start": effective(start), "rate_from": effective(first), "caps": caps.get(cap_key, {})})
        if not parts or sum(r["ppm"] for r in parts) != ppm(total):
            raise ValueError("Unreconciled rate " + region)
        # Haines's three administrative tax areas require a commissioned tax-map
        # match. A Census borough match cannot select any one of them.
        key = None if county == "Haines" else (places[place] if place else None)
        entries.append({"county": counties[county], "place": key, "area": city or region, "rates": parts,
                        "requires_area_code": county == "Haines"})
    if not entries or len({tuple(p["code"] for p in row["rates"]) for row in entries}) != len(entries):
        raise ValueError("Incomplete or repeated general-retail rate combination")
    payload = {"source": args.source, "sha256": sha256(args.workbook.read_bytes()).hexdigest(),
               "reviewed_on": args.reviewed_on, "through": args.through, "combinations": entries}
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
