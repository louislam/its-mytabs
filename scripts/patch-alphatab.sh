#!/bin/bash
# Apply alphaTab lyrics-below patch
# Uses the pre-patched files in ./patches/

set -e

PATCH_DIR="$(dirname "$0")/../patches"

# Determine base directory
if [ -d "frontend/node_modules/@coderline/alphatab/dist" ]; then
    ATDIR="frontend/node_modules/@coderline/alphatab/dist"
elif [ -d "node_modules/@coderline/alphatab/dist" ]; then
    ATDIR="node_modules/@coderline/alphatab/dist"
else
    echo "Cannot find alphaTab installation"
    exit 1
fi

# Check if already patched
if grep -q "lyricsPosition" "$ATDIR/alphaTab.core.mjs" 2>/dev/null; then
    echo "alphaTab already patched with lyricsPosition support"
    exit 0
fi

echo "Patching alphaTab at $ATDIR..."

# Copy pre-patched files
cp "$PATCH_DIR/alphaTab.core.mjs.patched" "$ATDIR/alphaTab.core.mjs"
cp "$PATCH_DIR/alphaTab.d.ts.patched" "$ATDIR/alphaTab.d.ts"

# Verify
if grep -q "lyricsPosition" "$ATDIR/alphaTab.core.mjs"; then
    echo "alphaTab patched successfully with lyricsPosition support"
else
    echo "ERROR: Patch failed - lyricsPosition not found"
    exit 1
fi
