# AgentVault 🏦

> AI-powered multi-chain wallet assistant built on the Open Wallet Standard (OWS)

## What is AgentVault?

AgentVault lets you manage your crypto wallet through natural language. Instead of copying addresses, switching between apps, or exposing private keys — you just talk to it.

Built entirely on OWS v1.2.0, AgentVault demonstrates what the agent-wallet future looks like: secure, local-first, and chain-agnostic.

## Demo
```
User: "Show all my addresses"
Agent: Here are your addresses across all chains:
       Ethereum: 0x172b...
       Solana: 2xShk...
       Bitcoin: bc1q8...
       ...

User: "Send 5 ETH to 0x1234"
Agent: 🚫 POLICY DENIED — Transaction exceeds limit: 5 ETH > 0.1 ETH max

User: "Send 0.05 ETH to 0x1234"
Agent: ✅ Policy approved — awaiting your confirmation
       [Approval popup appears]
```

## How It Works
```
User (chat UI)
     ↓  natural language
Claude AI (tool-calling)
     ↓  check_policy / get_addresses
Policy Engine (policy.js)
     ↓  enforce limits & allowlists
OWS Wallet (~/.ows/ AES-256-GCM)
     ↓  sign → wipe key from memory
Signed Transaction
```

## Key Features

- **Natural language wallet management** — no more copying addresses or switching apps
- **Policy engine** — enforces spending limits and chain allowlists before any key is touched
- **User approval flow** — every transaction requires explicit confirmation
- **Multi-chain** — Ethereum, Solana, Bitcoin, Cosmos, TRON, TON, Filecoin, Sui from one wallet
- **Local-first** — keys never leave your machine, no cloud, no vendor lock-in
- **Key isolation** — private keys are decrypted, used, and immediately wiped from memory

## Security Model

| Layer | Protection |
|---|---|
| Storage | AES-256-GCM encrypted at `~/.ows/` |
| Agent access | Scoped API token — agent never sees raw keys |
| Policy engine | Spending limits + chain allowlists enforced before signing |
| User approval | Every transaction requires manual confirmation |
| Key handling | Decrypted in-process, wiped immediately after signing |

## Tech Stack

- **OWS v1.2.0** — wallet storage, signing, policy engine
- **Claude AI** — natural language understanding + tool calling
- **Node.js + Express** — backend server
- **Vanilla HTML/CSS/JS** — frontend UI

## Quick Start
```bash
# Install OWS
npm install -g @open-wallet-standard/core

# Create wallet
ows wallet create --name agent-treasury

# Create API key
ows key create --name agent-token --wallet <wallet-id>

# Clone and run
git clone https://github.com/bayrakdarerdem/agentvault
cd agentvault
npm install
cp .env.example .env  # add your keys
node server.js
```

Open https://agentvault.onrender.com

## Built for OWS Hackathon

AgentVault was built to showcase the full OWS stack:
- Local-first key storage
- Agent access layer via API tokens
- Policy engine enforcement
- Multi-chain support from a single seed

Every agent deserves a wallet. Every wallet deserves a standard.
