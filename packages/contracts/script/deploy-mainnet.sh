#!/usr/bin/env bash
# Deploys ZethosVault to HSK mainnet from .env.mainnet. Without --broadcast it only simulates.
#
# forge loads .env by itself, but never overrides a variable that's already set. Everything Deploy.s.sol
# requires is exported from .env.mainnet first, and a blank value fails, so testnet values can't leak in.
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

env_file="${MAINNET_ENV_FILE:-.env.mainnet}"
rpc=https://mainnet.hsk.xyz
fail() {
  echo "Refusing to continue: $1" >&2
  exit 1
}

[ -f "$env_file" ] || fail "missing $env_file"
set -a
# shellcheck disable=SC1090
. "$(realpath "$env_file")"
set +a

required=(OPERATOR_ADDRESS QUOTE_SIGNER_ADDRESS EXECUTOR_ADDRESS FOUNDRY_ACCOUNT USDT_ADDRESS
  WHSK_ADDRESS WETH_ADDRESS MAX_IN_USDT_TO_WHSK MAX_IN_WHSK_TO_USDT MAX_IN_USDT_TO_WETH
  MAX_IN_WETH_TO_USDT)
for name in "${required[@]}"; do
  [ -n "${!name:-}" ] || fail "$name is blank in $env_file"
done

# Testnet role keys and test tokens must never reach mainnet.
testnet_values=" 0x369b982250d63d805849520d15f437b914bb2fe3 0x530b3d90cfb3e713b60140645528cb4cccc6a972
  0x042208ff20630c91ddc7c10c77de64224b0f2299 0x6c95fafeba8372bdc87574c5f0dd30064cd2115b
  0x1095085caf22ceea130f73a99234dd2c9216fb72 0x6ab12f10d4f0ef5b3faae774abb724a958f5bd80
  0x60786f25ae5deef658dd1da2f62dd6e7c7674716 "
for name in OPERATOR_ADDRESS QUOTE_SIGNER_ADDRESS EXECUTOR_ADDRESS USDT_ADDRESS WHSK_ADDRESS WETH_ADDRESS; do
  value="$(printf '%s' "${!name}" | tr '[:upper:]' '[:lower:]')"
  case "$testnet_values" in *"$value"*) fail "$name is a testnet address" ;; esac
done
case "$FOUNDRY_ACCOUNT" in
  zethos-owner | zethos-signer | zethos-executor | zethos-taker) fail "$FOUNDRY_ACCOUNT is a testnet keystore" ;;
esac

[ "$(cast chain-id -r "$rpc")" = 177 ] || fail "$rpc is not chain 177"

check_token() {
  local symbol decimals
  symbol="$(cast call "$2" 'symbol()(string)' -r "$rpc")"
  decimals="$(cast call "$2" 'decimals()(uint8)' -r "$rpc")"
  [ "$symbol" = "\"$1\"" ] && [ "$decimals" = "$3" ] ||
    fail "$2 is $symbol with $decimals decimals, expected $1 with $3"
  echo "  $1 $2 ($decimals decimals)"
}
echo "Tokens on chain 177:"
check_token USDT "$USDT_ADDRESS" 6
check_token WHSK "$WHSK_ADDRESS" 18
check_token WETH "$WETH_ADDRESS" 18

echo "Roles:"
echo "  owner    $OPERATOR_ADDRESS, balance $(cast balance "$OPERATOR_ADDRESS" -r "$rpc" --ether) HSK"
echo "  signer   $QUOTE_SIGNER_ADDRESS"
echo "  executor $EXECUTOR_ADDRESS"

if [ "${1:-}" = "--broadcast" ]; then
  echo "Broadcasting. --verify can exit 1 after a good deploy: check broadcast/ and the chain before rerunning."
  exec forge script script/Deploy.s.sol:Deploy --rpc-url "$rpc" --account "$FOUNDRY_ACCOUNT" \
    --broadcast --verify --verifier blockscout --verifier-url https://hsk.blockscout.com/api/
fi

forge script script/Deploy.s.sol:Deploy --rpc-url "$rpc" --sender "$OPERATOR_ADDRESS"
echo "Simulation only. Nothing was sent. Deploy with: bun run deploy:mainnet"
