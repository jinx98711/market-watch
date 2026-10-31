#!/bin/bash
cd "$(dirname "$0")"
exec python3 mt5/monitor_settings.py
