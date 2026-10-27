#!/bin/sh
set -eu

# BuildKit keeps dependency trees with hundreds of thousands of small files.
# Remove only unused cache older than one day; images, containers and volumes
# used by the applications are never selected by this command.
/usr/bin/docker builder prune --all --force --filter until=24h
