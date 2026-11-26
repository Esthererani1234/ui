"""Prepare the quarter's Washington DOR location rates and address archive metadata."""
import argparse
import csv
import hashlib
import io
import json
import re
import struct
import urllib.request
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('rates_url')
parser.add_argument('address_url')
parser.add_argument('output', type=Path)
args = parser.parse_args()

def download(url, kind):
    pattern = r'https://dor\.wa\.gov/sites/default/files/[0-9-]+/' + kind + r'_\d\dQ[1-4]\.zip'
    if not re.fullmatch(pattern, url):
        raise ValueError('Use a quarterly archive from the Department of Revenue.')
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read()

def decimal_ppm(value):
    ppm = Decimal(value) * 1000000
    if ppm != int(ppm) or not 0 <= ppm <= 1000000:
        raise ValueError('Invalid rate')
    return int(ppm)

quarter = args.rates_url.rsplit('_',1)[1].removesuffix('.zip')
if not args.address_url.endswith('_'+quarter+'.zip'):
    raise ValueError('Choose the same quarter for both archives.')
rates_bytes = download(args.rates_url, 'Rates')
rows = {}
with zipfile.ZipFile(io.BytesIO(rates_bytes)) as archive:
    with archive.open('Rates_'+quarter+'.csv') as raw:
        for row in csv.DictReader(io.TextIOWrapper(raw,encoding='utf-8-sig')):
            code = row['Code']
            state, local, total = (decimal_ppm(row[key]) for key in ['State','Local','Rate'])
            start, end = (date.fromisoformat(row[key]).isoformat() for key in ['Effective Date','Expiration Date'])
            if code in rows or not re.fullmatch(r'\d{4}',code) or state+local != total:
                raise ValueError('Inconsistent government location rate')
            rows[code] = [state,local,start,end]

data = download(args.address_url, 'State')
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    item = archive.getinfo('State_'+quarter+'.txt')
    if item.compress_type != zipfile.ZIP_DEFLATED or archive.testzip() is not None:
        raise ValueError('Invalid official address archive')
    name_length, extra_length = struct.unpack_from('<HH',data,item.header_offset+26)
    offset = item.header_offset + 30 + name_length + extra_length
    with archive.open(item) as raw:
        headers = raw.readline().decode().strip().split(',')
        if headers[:9] != ['ADDR_LOW','ADDR_HIGH','ODD_EVEN','STREET','STATE','ZIP','PLUS4','PERIOD','CODE']:
            raise ValueError('Address file format changed')
        count = sum(1 for line in raw if line.strip())
manifest = dict(period=quarter[2:]+'20'+quarter[:2], rates_url=args.rates_url,address_url=args.address_url,
    sha256=hashlib.sha256(data).hexdigest(), archive_bytes=len(data), offset=offset,
    compressed_bytes=item.compress_size, uncompressed_bytes=item.file_size,address_ranges=count,rates=rows)
args.output.write_text(json.dumps(manifest,indent=2)+'\n')
