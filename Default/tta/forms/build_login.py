"""Build CRO_Login.js from CRO_Login.src.js by injecting the logos as data URIs."""
import base64, pathlib
d = pathlib.Path(__file__).parent
src = (d / 'CRO_Login.src.js').read_text()
svg = (d / 'assets' / 'circularo-logo.svg').read_bytes().strip()
cir = 'data:image/svg+xml;base64,' + base64.b64encode(svg).decode()
sud = (d / 'assets' / 'sudocode.datauri').read_text().strip()
assert '__CIRCULARO_SVG__' in src and '__SUDOCODE_PNG__' in src
out = src.replace('__CIRCULARO_SVG__', cir).replace('__SUDOCODE_PNG__', sud)
(d / 'CRO_Login.js').write_text(out)
print(len(out))
