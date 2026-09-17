#!/usr/bin/env bash
#
# board-config.sh — shared constants for the Board Android flavour (H66).
# Sourced (never executed directly) by apply-board-flavor.sh and
# build-board-web-assets.sh so Board's applicationId has exactly one
# place to change, rather than a second hardcoded copy held in sync only
# by a comment (review finding P3, 2026-09-17 round 2).

BOARD_APPLICATION_ID="co.uk.auriqltd.sorted.board"
