"""Import the TRD location/rate attributes from a dated New Mexico RGIS CSV archive."""
import argparse
import csv
import io
import json
import re
import urllib.request
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("url")
parser.add_argument("start", type=date.fromisoformat)
parser.add_argument("end", type=date.fromisoformat)
parser.add_argument("output", type=Path)
args = parser.parse_args()
if not re.fullmatch(r"https://gstore\.unm\.edu/apps/rgis/datasets/[a-f0-9-]{36}/[\w.-]+\.derived\.csv", args.url) or args.start > args.end:
    parser.error("Supply the dated RGIS dataset linked by the Taxation and Revenue Department.")
with urllib.request.urlopen(args.url, timeout=30) as response:
    archive = zipfile.ZipFile(io.BytesIO(response.read()))
csv_name, = [name for name in archive.namelist() if name.endswith(".csv")]

def ppm(value):
    scaled = Decimal(value) * 10000
    if scaled != int(scaled) or not 0 <= scaled < 200000:
        raise ValueError("Invalid published percentage")
    return int(scaled)

locations = []
with archive.open(csv_name) as data:
    for row in csv.DictReader(io.TextIOWrapper(data, encoding="utf-8-sig")):
        code, class1, class2 = (row[field] for field in ("locat_cdr", "locat_cd1", "locat_cd2"))
        codes = [code] if code and not (class1 or class2) else [class1, class2]
        if not all(re.fullmatch(r"\d{2}-\d{3}", key) for key in codes):
            raise ValueError("Invalid reporting code")
        locations.append(dict(name=row["name"], county=row["county"], code=code,
                              tribal_codes=[class1,class2] if class1 else [], ppm=ppm(row["grt_rate"]),
                              class2_ppm=ppm(row["grt_rate2"]), note=row["note_key"]))
manifest = dict(source=args.url, valid_from=str(args.start), valid_until=str(args.end), locations=locations)
args.output.write_text(json.dumps(manifest, indent=2) + "\n")
