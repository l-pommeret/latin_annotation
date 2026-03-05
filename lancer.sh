#!/bin/bash
cd "$(dirname "$0")"

URL="http://localhost:8000"
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$URL" &
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "$URL" 2>/dev/null &
fi

python3 server.py
