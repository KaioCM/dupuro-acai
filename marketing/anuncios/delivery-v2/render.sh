#!/bin/sh
# Gera os PNGs (Chromium headless). Uso: sh render.sh
cd "$(dirname "$0")"; C=${CHROME:-/opt/pw-browsers/chromium}
"$C" --headless --no-sandbox --hide-scrollbars --virtual-time-budget=5000 --window-size=1080,1350 --screenshot=dupuro-delivery-v2-feed-4x5.png "file://$PWD/feed.html"
"$C" --headless --no-sandbox --hide-scrollbars --virtual-time-budget=5000 --window-size=1080,1920 --screenshot=dupuro-delivery-v2-stories-9x16.png "file://$PWD/story.html"
