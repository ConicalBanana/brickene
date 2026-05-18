#!/bin/bash
# Frontend start
python -m brickene.render_server &
# Backend start
http-server brickene/frontend/ &
# Recycle
trap 'kill $(jobs -p)' EXIT
wait
