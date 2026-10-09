#!/bin/sh
set -e
cd "$(dirname "$0")"
python3 gen_sql.py
bun build src/app.tsx --outfile=dist/app.js --minify --target=browser --define process.env.NODE_ENV='"production"' --define __BUILD__="\"$(date +%Y.%m.%d-%H%M)\""
python3 build.py
