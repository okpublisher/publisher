#!/usr/bin/env bash
# Βγάζει τα publisher/*.gs + appsscript.json ενός commit σε φάκελο (για σύγκριση με ό,τι τρέχει).
#   tools/gas/repo_at.sh <commit> <φάκελος>
set -euo pipefail
rev="$1"; out="$2"
rm -rf "$out"; mkdir -p "$out"
tmp="$(mktemp -d)"
git archive "$rev" publisher | tar -x -C "$tmp"
find "$tmp/publisher" -maxdepth 1 -type f \( -name '*.gs' -o -name 'appsscript.json' \) -exec cp {} "$out"/ \;
rm -rf "$tmp"
