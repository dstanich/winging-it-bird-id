#!/usr/bin/env bash
#
# Bootstrap a git worktree (or fresh local checkout) so tests, typecheck, lint,
# client dev/build, and server scripts work immediately without manual setup.
#
# Safe and idempotent: fast no-op when dependencies, database, and symlinks are
# already in place. Can be run directly or from a SessionStart agent hook.
#
# Usage: ./scripts/setup-worktree.sh [--link-env] [--days <n>]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

LINK_ENV=false
SEED_DAYS=15

while [ $# -gt 0 ]; do
  case "$1" in
    --link-env)
      LINK_ENV=true
      shift
      ;;
    --days)
      SEED_DAYS="${2:?--days requires a positive integer}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--link-env] [--days <n>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# If running inside a git worktree, .git is a file pointing to
# <main-repo>/.git/worktrees/<name>. Parse it directly so this works even inside
# a sandbox that cannot stat <main-repo>/.git.
MAIN_REPO=""
if [ -f "$REPO_ROOT/.git" ]; then
  GITDIR_LINE="$(sed -n 's/^gitdir: //p' "$REPO_ROOT/.git")"
  case "$GITDIR_LINE" in
    */.git/worktrees/*)
      MAIN_REPO="${GITDIR_LINE%/.git/worktrees/*}"
      ;;
  esac
fi

clone_or_copy_dir() {
  local src="$1"
  local dst="$2"
  rm -rf "$dst"
  if cp -cR "$src" "$dst" 2>/dev/null; then
    return 0
  fi
  cp -R "$src" "$dst"
}

populate_ffmpeg_from_cache() {
  local target="$REPO_ROOT/server/node_modules/ffmpeg-static/ffmpeg"
  if [ -x "$target" ]; then
    return 0
  fi

  local platform arch
  platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64) arch="x64" ;;
    aarch64) arch="arm64" ;;
  esac

  local cache_dir
  for cache_dir in "$HOME/Library/Caches/ffmpeg-static-nodejs" "${XDG_CACHE_HOME:-$HOME/.cache}/ffmpeg-static-nodejs"; do
    if [ ! -d "$cache_dir" ]; then
      continue
    fi
    local json_file
    json_file="$(grep -l "ffmpeg-${platform}-${arch}\.gz" "$cache_dir"/*.json 2>/dev/null | head -n 1 || true)"
    if [ -n "$json_file" ]; then
      local body_file="${json_file%.json}.body"
      if [ -f "$body_file" ]; then
        gunzip -c "$body_file" > "$target"
        chmod +x "$target"
        echo "✓ Extracted cached ffmpeg-static binary (${platform}-${arch})"
        return 0
      fi
    fi
  done

  echo "Warning: Could not find cached ffmpeg-static binary for ${platform}-${arch}" >&2
  return 1
}

install_server_deps() {
  if [ -x "$REPO_ROOT/server/node_modules/.bin/vitest" ] \
    && [ -f "$REPO_ROOT/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ] \
    && [ -x "$REPO_ROOT/server/node_modules/ffmpeg-static/ffmpeg" ]; then
    return 0
  fi

  echo "Installing server dependencies..."
  if [ -n "$MAIN_REPO" ] && [ -d "$MAIN_REPO/server/node_modules" ] && [ -r "$MAIN_REPO/server/node_modules" ]; then
    echo "Cloning server/node_modules from main worktree..."
    if clone_or_copy_dir "$MAIN_REPO/server/node_modules" "$REPO_ROOT/server/node_modules"; then
      echo "✓ Cloned server/node_modules"
      return 0
    fi
  fi

  if npm --prefix "$REPO_ROOT/server" ci --prefer-offline --no-audit --no-fund; then
    echo "✓ Installed server dependencies via npm ci"
    return 0
  fi

  echo "Falling back to offline server install (--ignore-scripts + cached native binaries)..."
  npm --prefix "$REPO_ROOT/server" ci --ignore-scripts --prefer-offline --no-audit --no-fund
  npm --prefix "$REPO_ROOT/server" rebuild better-sqlite3
  populate_ffmpeg_from_cache
  echo "✓ Installed server dependencies from local caches"
}

install_pkg_deps() {
  local pkg_rel="$1"
  local check_path="$2"
  local pkg_dir="$REPO_ROOT/$pkg_rel"

  if [ -e "$pkg_dir/$check_path" ]; then
    return 0
  fi

  echo "Installing $pkg_rel dependencies..."
  if [ -n "$MAIN_REPO" ] && [ -d "$MAIN_REPO/$pkg_rel/node_modules" ] && [ -r "$MAIN_REPO/$pkg_rel/node_modules" ]; then
    echo "Cloning $pkg_rel/node_modules from main worktree..."
    if clone_or_copy_dir "$MAIN_REPO/$pkg_rel/node_modules" "$pkg_dir/node_modules"; then
      echo "✓ Cloned $pkg_rel/node_modules"
      return 0
    fi
  fi

  npm --prefix "$pkg_dir" ci --prefer-offline --no-audit --no-fund
  echo "✓ Installed $pkg_rel dependencies via npm ci"
}

install_server_deps
install_pkg_deps "client" "node_modules/.bin/next"
install_pkg_deps "client/scripts/scheduled-publish" "node_modules/@aws-sdk"

# Seed the local SQLite DB + downloads directory if the DB does not exist yet
if [ ! -f "$REPO_ROOT/server/data/bird-data.db" ]; then
  echo "Seeding local SQLite database ($SEED_DAYS days)..."
  npm --prefix "$REPO_ROOT/server" run seed:local-db -- "$SEED_DAYS"
fi

# Ensure client/public/downloads points to ../../server/downloads
if [ ! -L "$REPO_ROOT/client/public/downloads" ] && [ ! -e "$REPO_ROOT/client/public/downloads" ]; then
  ln -s ../../server/downloads "$REPO_ROOT/client/public/downloads"
  echo "✓ Linked client/public/downloads -> ../../server/downloads"
fi

# Optionally symlink .env files from the main worktree for manual live testing
if [ "$LINK_ENV" = true ] && [ -n "$MAIN_REPO" ]; then
  for sub in server client; do
    if [ ! -e "$REPO_ROOT/$sub/.env" ] && [ ! -L "$REPO_ROOT/$sub/.env" ]; then
      if [ -f "$MAIN_REPO/$sub/.env" ]; then
        ln -s "$MAIN_REPO/$sub/.env" "$REPO_ROOT/$sub/.env"
        echo "✓ Linked $sub/.env -> $MAIN_REPO/$sub/.env"
      fi
    fi
  done
fi
