#!/bin/sh
set -e
cd "$(dirname "$0")"
python3 gen_sql.py
NAME=$(python3 -c "import json;print(json.load(open('brand.json'))['name'])")
URL=$(python3 -c "import json;print(json.load(open('brand.json'))['webUrl'])")
TAG=$(python3 -c "import json;print(json.load(open('brand.json'))['tagline'])")
bun build src/app.tsx --outfile=dist/app.js --minify --target=browser \
  --define process.env.NODE_ENV='"production"' \
  --define __BUILD__="\"$(date +%Y.%m.%d-%H%M)\"" \
  --define __APP_NAME__="\"$NAME\"" --define __APP_TAGLINE__="\"$TAG\"" --define __WEB_URL__="\"$URL\""
python3 build.py
