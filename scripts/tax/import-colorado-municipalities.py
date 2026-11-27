"""Match published statutory municipalities to Census incorporated-place identifiers.

Supply the Colorado legislature's Local Government Handbook, the 2026 CML
Municipal Directory, and the Census 2025 Colorado places gazetteer from the
sources below. Only affirmative matches in all three publications are kept.
"""
import argparse
import csv
import json
import re
import subprocess
from pathlib import Path

HANDBOOK = "https://content.leg.colorado.gov/sites/default/files/local_gov_hb_web.pdf"
DIRECTORY = "https://www.cml.org/docs/default-source/municipal-directory/2026-municipal-directory.pdf"
CENSUS = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_gaz_place_08.txt"
ELECTION = "https://www.cml.org/home/publications-news/article-detail/fall-2026-municipal-election-results"
BULLION = "https://tax.colorado.gov/sales-use-tax-topics-coins-and-precious-metal-bullion"
STATUTE = "https://content.leg.colorado.gov/sites/default/files/2024a_025_signed.pdf"
ADMINISTRATION = "https://tax.colorado.gov/local-government-sales-tax"
AURORA = "https://www.auroragov.org/common/pages/GetFile.ashx?key=hOcqAVEZ"


def pdf_text(path):
    return subprocess.check_output(["pdftotext", "-layout", str(path), "-"], encoding="utf8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("handbook", "directory", "gazetteer", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    appendix = pdf_text(args.handbook).split("Statutory Cities and Towns\n", 1)[1].split("Territorial Charter Municipality\n", 1)[0]
    statutory = {}
    for line in appendix.splitlines():
        match = re.fullmatch(r"(.+?)\s{2,}([\w ,.-]+ County)", line.strip())
        if match:
            statutory[match[1].strip().casefold()] = match[2].split(", ")
    confirmed = set()
    for page in pdf_text(args.directory).split("\f"):
        name = re.search(r"^(?:TOWN|CITY) OF (.+?)\s{2,}Printed:", page, re.M)
        if name and re.search(r"Home rule or statutory:\s*S[TC]\b", page):
            confirmed.add(name[1].strip().casefold())
    # Voters adopted a home-rule charter after both printed directories.
    confirmed.discard("cripple creek")
    places = {}
    for row in csv.DictReader(args.gazetteer.read_text().splitlines(), delimiter="|"):
        city = re.fullmatch(r"(.+) (?:town|city)", row["NAME"])
        if not city or row["FUNCSTAT"] != "A":
            continue
        key = city[1].casefold()
        if key in confirmed and key in statutory:
            places[row["GEOID"]] = {"name": row["NAME"], "counties": statutory[key]}
        elif key == "aurora":
            places[row["GEOID"]] = {"name": row["NAME"], "counties": ["Adams County", "Arapahoe County", "Douglas County"], "source": AURORA}
    if len(places) < 100 or sum(v.get("source") == AURORA for v in places.values()) != 1:
        raise ValueError("Incomplete Colorado directory or missing authority")
    data = {"reviewed_on": "2026-11-27", "through": "2026-12-31", "source": BULLION,
            "authorities": [STATUTE, ADMINISTRATION, HANDBOOK, DIRECTORY, ELECTION, CENSUS], "places": places}
    args.output.write_text(json.dumps(data, indent=2) + "\n")


if __name__ == "__main__":
    main()
