#!/usr/bin/env bash
set -e

cd /opt/jot.rip
git pull
docker compose up -d --build