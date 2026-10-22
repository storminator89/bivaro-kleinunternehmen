#!/bin/sh
# Read-only package/executable inspection; never install, remove or invoke gs.
set -eu
if command -v gs >/dev/null 2>&1; then
  printf '%s\n' 'Ghostscript absence check failed: executable present.' >&2
  exit 1
fi
if ! packages="$(dpkg-query -W -f='${binary:Package} ${db:Status-Status}\n' 2>/dev/null)"; then
  printf '%s\n' 'Ghostscript absence check failed: package inventory unavailable.' >&2
  exit 1
fi
# libgsf, libgssapi, libgsasl and libgstreamer are unrelated libraries.
# Debian interpreter libraries use libgs, libgs-... or libgs<version> names.
if ! {
  printf '%s\n' "$packages" | awk '
  NF != 2 { invalid=1; next }
  $1 !~ /^[a-z0-9][a-z0-9+.-]*(:[a-z0-9][a-z0-9-]*)?$/ { invalid=1 }
  $2 !~ /^(not-installed|config-files|half-installed|unpacked|half-configured|triggers-awaited|triggers-pending|installed)$/ { invalid=1 }
  { rows++ }
  $2 != "not-installed" && $2 != "config-files" && $1 ~ /^(ghostscript($|[-:])|libgs($|[0-9:-]))/ { found=1 }
  END { exit (invalid || found || rows == 0) }
'
} 2>/dev/null; then
  printf '%s\n' 'Ghostscript absence check failed: interpreter package present or invalid inventory.' >&2
  exit 1
fi
printf '%s\n' '{"event":"ghostscript-absence","executable":"absent","installedPackages":"absent"}'
