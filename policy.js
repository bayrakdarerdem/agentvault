#!/usr/bin/env node

const input = JSON.parse(process.argv[2] || '{}');

const LIMITS = {
  daily_max_usd: 100,
  per_tx_max_eth: 0.1,
  allowed_chains: ["eip155:1", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "bip122:000000000019d6689c085ae165831e93"]
};

function evaluate(ctx) {
  // Chain whitelist check
  if (ctx.chainId && !LIMITS.allowed_chains.includes(ctx.chainId)) {
    return { allow: false, reason: `Chain ${ctx.chainId} is not whitelisted` };
  }

  // Per-transaction ETH limit
  if (ctx.chainId === "eip155:1" && ctx.value) {
    const ethValue = parseInt(ctx.value, 16) / 1e18;
    if (ethValue > LIMITS.per_tx_max_eth) {
      return { allow: false, reason: `Transaction exceeds limit: ${ethValue} ETH > ${LIMITS.per_tx_max_eth} ETH max` };
    }
  }

  return { allow: true, reason: "Transaction approved by policy engine" };
}

const result = evaluate(input);
process.stdout.write(JSON.stringify(result));
