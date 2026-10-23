#!/bin/bash
cd /Users/denistatarenko/Work/other/1M_kg_health_webapp || exit 1
exec python3 -m http.server 8770 --bind 127.0.0.1
