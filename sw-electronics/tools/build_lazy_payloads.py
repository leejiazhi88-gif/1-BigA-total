"""Build small first-view payloads; keep canonical financial data unchanged."""
import json
from pathlib import Path

def build(root):
    catalog=json.loads((root/'catalog.json').read_text(encoding='utf-8'))
    for item in catalog['industries']:
        folder=root/item['path']
        data=json.loads((folder/'data.json').read_text(encoding='utf-8'))
        companies=data.pop('latestCompanies')
        for name,value in [('main.json',data),('companies.json',companies)]:
            (folder/name).write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')

    # Keep published bytes stable across Windows and Linux Git checkouts.
    for file in root.rglob('*'):
        if file.is_file() and file.suffix in {'.json','.js','.csv','.html','.css','.md'}:
            raw=file.read_bytes()
            if b'\r\n' in raw:file.write_bytes(raw.replace(b'\r\n',b'\n'))

if __name__=='__main__':
    build(Path(__file__).resolve().parents[1])
