import pathlib, json
brand = json.loads(pathlib.Path('brand.json').read_text())
NAME = brand['name']
css = pathlib.Path('src/styles.css').read_text()
js = pathlib.Path('dist/app.js').read_text().replace('</script', '<\\/script')
html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#ffffff">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="{NAME}">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="description" content="{NAME}. Staff sign in.">
<meta name="robots" content="noindex">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<title>{NAME}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='3' y='10' width='18' height='12' rx='2' fill='%23a8781f'/%3E%3Cpath d='M7 10V7a5 5 0 0 1 10 0v3' stroke='%23a8781f' stroke-width='2.4' fill='none'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>{css}</style>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.js"></script>
<script>if(!window.supabase)document.write('<script src="https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js"><\\/script>')</script>
</head>
<body>
<div id="root"></div>
<script>{js}</script>
</body>
</html>
'''
out = pathlib.Path('dist/site'); out.mkdir(parents=True, exist_ok=True)
(out/'index.html').write_text(html)
import json, shutil
for f in pathlib.Path('public').iterdir(): shutil.copy(f, out/f.name)
(out/'manifest.webmanifest').write_text(json.dumps({
  'name': NAME, 'short_name': NAME[:12], 'description': brand['tagline'],
  'start_url': './', 'scope': './', 'display': 'standalone', 'orientation': 'any',
  'background_color': '#ffffff', 'theme_color': '#1d5fd6',
  'icons': [
    {'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
    {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
    {'src': 'icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
  ]}, indent=2))
print(len(html))
