#!/bin/bash
# Frontend start
python -m brickene &
# Backend start
http-server brickene/frontend/ &
# Recycle
trap 'kill $(jobs -p)' EXIT
wait
