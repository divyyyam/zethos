#!/usr/bin/env bash
# Runs the engine locally in live mode against HSK testnet. Public values come from
# packages/contracts/.env. The hot keys stay in their encrypted keystores and only ever exist in this
# process's environment, so nothing secret is written to a file or shown on a command line.
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

contracts_env=../../packages/contracts/.env
[ -f "$contracts_env" ] || { echo "Missing $contracts_env" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$contracts_env"
set +a

password_file="${ZETHOS_KEYSTORE_PASSWORD_FILE:-$HOME/.foundry/zethos-testnet-password}"
decrypt() {
  CAST_UNSAFE_PASSWORD="$(cat "$password_file")" cast wallet decrypt-keystore "$1" |
    grep -oE '0x[0-9a-fA-F]{64}'
}

export ENGINE_MODE=live
export CHAIN_ID=133
export HSK_RPC_URL="${HSK_RPC_URL:-https://testnet.hsk.xyz}"
export CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:3000}"
export SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"
QUOTE_SIGNER_KEY="$(decrypt zethos-signer)"
EXECUTOR_KEY="$(decrypt zethos-executor)"
export QUOTE_SIGNER_KEY EXECUTOR_KEY

# Lets the vars above reach the Worker without a .dev.vars file.
export CLOUDFLARE_INCLUDE_PROCESS_ENV=true
# Keeps PAPER_SIGNER_KEY, ADMIN_TOKEN and any Neon URL from the local env files.
env_files=()
for file in .dev.vars .env.neon; do [ -f "$file" ] && env_files+=(--env-file "$file"); done
exec bunx wrangler dev --port "${PORT:-8787}" "${env_files[@]}"
