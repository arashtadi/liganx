#!/bin/bash
# Liganx: auto-start the dock server on container boot (run by /start.sh)
nohup bash /workspace/start_dock_server.sh >/dev/null 2>&1 &
