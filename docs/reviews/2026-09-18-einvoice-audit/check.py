from pathlib import Path
from lxml import etree
from saxonche import PySaxonProcessor
import json
import sys
base=Path(__file__).resolve().parent
rules=Path(sys.argv[1]).resolve()  # extracted KoSIT configuration release
xsd=etree.XMLSchema(etree.parse(str(rules/'resources/cii/16b/xsd/CrossIndustryInvoice_100pD16B.xsd')))
results={}
with PySaxonProcessor(license=False) as proc:
 xslt=proc.new_xslt30_processor()
 runners={k:xslt.compile_stylesheet(stylesheet_file=str(rules/p)) for k,p in {'EN16931':'resources/cii/16b/xsl/EN16931-CII-validation.xsl','XRechnung':'resources/xrechnung/3.0.2/xsl/XRechnung-CII-validation.xsl'}.items()}
 for f in sorted((base/'fixtures').glob('*.xml')):
  r={'xsd_valid':xsd.validate(etree.parse(str(f))),'failures':[]}
  for name,runner in runners.items():
   if f.stem.startswith('facturx') and name=='XRechnung':continue
   output=runner.transform_to_string(source_file=str(f))
   tree=etree.fromstring(output.encode())
   for assertion in tree.findall('.//{http://purl.oclc.org/dsdl/svrl}failed-assert'):
    r['failures'].append({'source':name,'id':assertion.get('id'),'flag':assertion.get('flag'),'text':''.join(assertion.itertext()).strip()})
  results[f.stem]=r
  print(f.stem,'XSD',r['xsd_valid'],[(a['id'],a['flag']) for a in r['failures']])
(base/'validation-results.json').write_text(json.dumps(results,indent=2,ensure_ascii=False))
