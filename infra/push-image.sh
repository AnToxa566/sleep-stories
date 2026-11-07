#!/usr/bin/env bash
# Builds the API image on this Mac and pushes it to Artifact Registry (slice 3.2).
# This is the bootstrap path; a GitHub workflow takes it over later (slice 4).
#
# The image is built for linux/amd64 (Cloud Run), and this Mac is arm64, so the build runs
# under emulation: the first one is slow (many minutes), later ones reuse the cache.
# The tag is the short git SHA of HEAD. Only what goes into the image has to be clean in
# git, so the infra/ scripts themselves may be uncommitted. --provenance=false: without it
# buildx pushes an image index with an attestation next to the image, which makes two
# versions per tag in the registry and spoils the "keep the 2 latest" cleanup policy.
#
# Usage: DRY_RUN=1 bash infra/push-image.sh   (prints the build command, runs nothing)
#        bash infra/push-image.sh
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

cd "${_infra_dir}/.."

# Everything the Dockerfile copies or ignores (apps/api/Dockerfile, .dockerignore).
IMAGE_INPUTS=(apps packages package.json package-lock.json nx.json tsconfig.base.json .dockerignore)

dirty="$(git status --porcelain -- "${IMAGE_INPUTS[@]}")"
if [ -n "$dirty" ]; then
  printf 'Uncommitted changes in what goes into the image (paths only):\n%s\n' \
    "$(printf '%s\n' "$dirty" | head -n 10)" >&2
  if is_dry; then
    log "DRY_RUN: a real run would stop here; commit first, so the tag names the code"
  else
    die "commit or stash these changes first: the image tag is the commit, so the tree must match it"
  fi
fi

tag="$(git rev-parse --short=12 HEAD)"
image="$(image_path):${tag}"

if ! is_dry; then
  command -v docker >/dev/null 2>&1 || die "docker is not installed"
  docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable; start Docker Desktop"
  # Only the presence of the registry host in the Docker config is checked; the file is
  # never printed (it can hold credentials).
  docker_config="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
  if ! grep -Fq "\"$(registry_host)\"" "$docker_config" 2>/dev/null; then
    die "Docker is not set up for $(registry_host); run once: gcloud auth configure-docker $(registry_host)"
  fi
fi
preflight

if ! is_dry && image_tag_exists "$tag"; then
  log "tag ${tag} is already in the registry: nothing to build (commit a change to get a new tag)"
else
  log "Building ${image} for linux/amd64 and pushing it"
  run docker buildx build \
    --platform=linux/amd64 \
    --provenance=false \
    -f apps/api/Dockerfile \
    -t "$image" \
    --push .
fi

if is_dry; then
  result_add "image ${tag} in the registry" SKIPPED "dry run"
elif image_tag_exists "$tag"; then
  result_add "image ${tag} in the registry" PASS
else
  result_add "image ${tag} in the registry" FAIL "the push did not leave this tag"
fi
result_add "image" INFO "$image"
result_add "next" INFO "bash infra/deploy.sh ${tag}"
result_print "push-image ${PROJECT_ID}"
