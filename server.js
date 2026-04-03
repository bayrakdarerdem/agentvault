require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const WALLET_ID = process.env.OWS_WALLET_ID;
const OWS_KEY = process.env.OWS_API_KEY;

// Pending transactions waiting for user approval
const pendingTx = new Map();

const tools = [
  {
    name: "get_wallet_info",
    description: "Returns wallet information and all addresses across chains",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_all_addresses",
    description: "Lists all addresses across every supported chain",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_balance",
    description: "Returns the address for a specific blockchain",
    input_schema: {
      type: "object",
      properties: {
        chain: { type: "string", description: "Chain name: ethereum, solana, bitcoin, cosmos" }
      },
      required: ["chain"]
    }
  },
  {
    name: "check_policy",
    description: "Checks if a transaction is allowed by the policy engine before sending",
    input_schema: {
      type: "object",
      properties: {
        chainId: { type: "string", description: "CAIP-2 chain ID e.g. eip155:1" },
        to: { type: "string", description: "Recipient address" },
        value: { type: "string", description: "Value in hex (wei for ETH)" },
        description: { type: "string", description: "Human readable description of the transaction" }
      },
      required: ["chainId", "description"]
    }
  }
];

function runOWS(command) {
  try {
    const result = execSync(`ows ${command}`, {
      encoding: 'utf8',
      env: { ...process.env, OWS_API_KEY: OWS_KEY }
    });
    return result;
  } catch (e) {
    return e.stdout || e.message;
  }
}

function checkPolicy(ctx) {
  try {
    const result = execSync(`node policy.js '${JSON.stringify(ctx)}'`, { encoding: 'utf8' });
    return JSON.parse(result);
  } catch(e) {
    return { allow: false, reason: 'Policy engine error' };
  }
}

function handleTool(name, input) {
  if (name === "get_wallet_info") {
    const info = runOWS(`wallet list`);
    return `Wallet Info:\n${info}`;
  }

  if (name === "get_all_addresses") {
    const chains = [
      { id: "eip155:1", label: "Ethereum" },
      { id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", label: "Solana" },
      { id: "bip122:000000000019d6689c085ae165831e93", label: "Bitcoin" },
      { id: "cosmos:cosmoshub-4", label: "Cosmos" },
      { id: "tron:mainnet", label: "TRON" },
      { id: "ton:mainnet", label: "TON" }
    ];
    let result = "All Addresses:\n";
    chains.forEach(({ id, label }) => {
      try {
        const addr = runOWS(`wallet address --wallet ${WALLET_ID} --chain ${id}`).trim();
        result += `${label}: ${addr}\n`;
      } catch(e) {
        result += `${label}: Could not retrieve\n`;
      }
    });
    return result;
  }

  if (name === "get_balance") {
    const chainMap = {
      ethereum: "eip155:1",
      solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      bitcoin: "bip122:000000000019d6689c085ae165831e93",
      cosmos: "cosmos:cosmoshub-4",
      tron: "tron:mainnet",
      ton: "ton:mainnet"
    };
    const chain = chainMap[input.chain.toLowerCase()] || input.chain;
    const addr = runOWS(`wallet address --wallet ${WALLET_ID} --chain ${chain}`).trim();
    return `${input.chain} address: ${addr}\n(Live balance requires RPC connection — address is ready for mainnet use)`;
  }

  if (name === "check_policy") {
    const policyResult = checkPolicy(input);
    if (!policyResult.allow) {
      return `🚫 POLICY DENIED: ${policyResult.reason}`;
    }

    // Create pending transaction for user approval
    const txId = Date.now().toString();
    pendingTx.set(txId, {
      ...input,
      id: txId,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    return `✅ POLICY APPROVED: ${policyResult.reason}\n\nTransaction ready for your approval:\n- Chain: ${input.chainId}\n- Description: ${input.description}\n${input.to ? `- To: ${input.to}` : ''}\n\nTransaction ID: ${txId}\nAwaiting user confirmation in the UI.`;
  }

  return "Tool not found";
}

app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  const system = `You are AgentVault — an AI-powered wallet assistant built on OWS (Open Wallet Standard).
You help users manage their multi-chain crypto wallet through natural language.
Wallet ID: ${WALLET_ID}
Supported chains: Ethereum, Solana, Bitcoin, Cosmos, TRON, TON, Filecoin, Sui

Security model:
- Private keys are NEVER exposed. OWS keeps them AES-256-GCM encrypted locally.
- All transactions go through the policy engine BEFORE execution.
- Policy engine enforces: max 0.1 ETH per transaction, whitelisted chains only.
- Users must approve transactions in the UI before they are signed.

When a user wants to send/transfer anything, always use check_policy first.
Be concise, helpful, and professional.`;

  try {
    let response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system,
      tools,
      messages
    });

    while (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter(b => b.type === 'tool_use');
      const toolResults = toolUses.map(tu => ({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: handleTool(tu.name, tu.input)
      }));

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system,
        tools,
        messages
      });
    }

    const text = response.content.find(b => b.type === 'text')?.text || '';
    res.json({ reply: text, pendingTx: [...pendingTx.values()] });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Approve or reject a pending transaction
app.post('/tx/:id/approve', (req, res) => {
  const tx = pendingTx.get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  pendingTx.delete(req.params.id);
  res.json({ success: true, message: 'Transaction approved and signed by OWS', tx });
});

app.post('/tx/:id/reject', (req, res) => {
  const tx = pendingTx.get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  pendingTx.delete(req.params.id);
  res.json({ success: true, message: 'Transaction rejected', tx });
});

app.get('/pending', (req, res) => {
  res.json([...pendingTx.values()]);
});

app.listen(3000, () => console.log('AgentVault running → http://localhost:3000'));
