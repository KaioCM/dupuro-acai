#!/bin/sh
# Gera os PNGs do anúncio a partir do HTML (Chromium headless). Uso: sh render.sh
cd "$(dirname "$0")"
CHROME=${CHROME:-/opt/pw-browsers/chromium}
"$CHROME" --headless --no-sandbox --hide-scrollbars --virtual-time-budget=4000 --window-size=1080,1350 --screenshot=dupuro-delivery-feed-4x5.png "file://$PWD/feed.html"
"$CHROME" --headless --no-sandbox --hide-scrollbars --virtual-time-budget=4000 --window-size=1080,1920 --screenshot=dupuro-delivery-stories-9x16.png "file://$PWD/story.html"
