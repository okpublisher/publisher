#!/usr/bin/env bash
# Βγάζει τα <GAS_DIR>/*.gs + appsscript.json ενός commit σε φάκελο (για σύγκριση με ό,τι τρέχει).
# GAS_DIR: προεπιλογή publisher (φόρμα: form).
#   tools/gas/repo_at.sh <commit> <φάκελος>
set -euo pipefail
rev="$1"; out="$2"; dir="${GAS_DIR:-publisher}"
rm -rf "$out"; mkdir -p "$out"
tmp="$(mktemp -d)"
git archive "$rev" "$dir" | tar -x -C "$tmp"
find "$tmp/$dir" -maxdepth 1 -type f \( -name '*.gs' -o -name 'appsscript.json' \) -exec cp {} "$out"/ \;
rm -rf "$tmp"
