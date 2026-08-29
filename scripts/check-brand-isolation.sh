#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORBIDDEN_TERM="word""press"

if git -C "${ROOT_DIR}" grep -Iin "${FORBIDDEN_TERM}" -- . ':!scripts/check-brand-isolation.sh'; then
  printf '%s\n' 'Brand isolation check failed in the working tree.' >&2
  exit 1
fi

if git -C "${ROOT_DIR}" log --all --format='%B' | tr '[:upper:]' '[:lower:]' | grep -Fq "${FORBIDDEN_TERM}"; then
  printf '%s\n' 'Brand isolation check failed in commit messages.' >&2
  exit 1
fi

while IFS= read -r commit; do
  if git -C "${ROOT_DIR}" grep -Ii "${FORBIDDEN_TERM}" "${commit}" -- . ':!scripts/check-brand-isolation.sh' >/dev/null 2>&1; then
    printf 'Brand isolation check failed in commit %s.\n' "${commit}" >&2
    exit 1
  fi
done < <(git -C "${ROOT_DIR}" rev-list --all)

printf '%s\n' 'Brand isolation check passed.'
