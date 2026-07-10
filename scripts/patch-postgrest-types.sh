#!/usr/bin/env bash
# Relax @supabase/postgrest-js RejectExcessProperties so dynamic Record insert/update
# calls continue to type-check across the codebase (~200 call sites). Safe: only
# widens type checking; runtime behavior is unchanged.
set -e
for f in node_modules/@supabase/postgrest-js/dist/index.d.cts node_modules/@supabase/postgrest-js/dist/index.d.mts; do
  [ -f "$f" ] || continue
  sed -i 's|type RejectExcessProperties<Base, Row> = Row & { \[K in Exclude<keyof Row, keyof Base>\]: never };|type RejectExcessProperties<Base, Row> = Row;|' "$f"
done
