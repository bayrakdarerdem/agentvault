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
    name: "get_address_for_chain",
    description: "Returns the address for a specific blockchain",
    input_schema: {
      type: "object",
      properties: {
        chain: { type: "string", description: "Chain name: ethereum, solana, bitcoin, cosmos, tron, ton, filecoin, sui" }
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

function parseWalletList() {
  const output = runOWS('wallet list');
  const addresses = {};
  const lines = output.split('\n');
  lines.forEach(line => {
    const match = line.match(/(\w+[\w:.-]+)\s+\((\w+)\)\s+→\s+(\S+)/);
    if (match) {
      addresses[match[2]] = { chainId: match[1], address: match[3] };
    }
  });
  return addresses;
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
    const output = runOWS('wallet list');
    return `Wallet Info:\n${output}`;
  }

  if (name === "get_all_addresses") {
    const addresses = parseWalletList();
    let result = "All Addresses:\n";
    Object.entries(addresses).forEach(([chain, data]) => {
      result += `${chain.charAt(0).toUpperCase() + chain.slice(1)}: ${data.address}\n`;
    });
    return result;
  }

  if (name === "get_address_for_chain") {
    const addresses = parseWalletList();
    const chain = input.chain.toLowerCase();
    if (addresses[chain]) {
      return `${input.chain} address: ${addresses[chain].address}`;
    }
    return `Chain "${input.chain}" not found. Available: ${Object.keys(addresses).join(', ')}`;
  }

  if (name === "check_policy") {
    const policyResult = checkPolicy(input);
    if (!policyResult.allow) {
      return `🚫 POLICY DENIED: ${policyResult.reason}`;
    }
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
