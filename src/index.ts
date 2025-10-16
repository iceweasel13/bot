import 'dotenv/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import TelegramBot from 'node-telegram-bot-api';
import { setApiKey, tradeCoin } from '@zoralabs/coins-sdk';

// ---------- Tipler ----------
type BotConfig = {
  name: string;
  apiKey: string;
  privateKey: `0x${string}`;
  amountEth: number;
  lastBoughtCoin: string | null;
};

// ---------- ENV yardımcıları ----------
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return String(v).trim();
}

let tickCount = 0;
let walletDone = false;

function normalizePrivateKey(raw: string): `0x${string}` {
  let k = raw.trim();
  if (!k.startsWith('0x')) k = `0x${k}`;
  if (!(k.length === 66 && /^0x[0-9a-fA-F]{64}$/.test(k))) {
    console.error('PRIVATE_KEY must be 0x-prefixed 64-hex string.');
    process.exit(1);
  }
  return k as `0x${string}`;
}

// ---------- Config ----------
const HTTP_RPC = requireEnv('BASE_HTTP_RPC');
const TARGET = requireEnv('TARGET_WALLET');
const TG_TOKEN = requireEnv('TELEGRAM_BOT_TOKEN');
const TG_DEST = (() => {
  const v = process.env.TELEGRAM_CHANNEL || process.env.TELEGRAM_CHAT_ID;
  if (!v || !String(v).trim()) {
    console.error('Missing required env: TELEGRAM_CHANNEL or TELEGRAM_CHAT_ID');
    process.exit(1);
  }
  return String(v).trim();
})();

const botConfig: BotConfig = {
  name: 'MainWallet',
  apiKey: requireEnv('ZORA_API_KEY'),
  privateKey: normalizePrivateKey(requireEnv('PRIVATE_KEY')),
  amountEth: parseFloat(process.env.AUTOBUY_ETH || '0.05'),
  lastBoughtCoin: null,
};

// ---------- Telegram ----------
const bot = new TelegramBot(TG_TOKEN, { polling: false });

function normalizeDest(idOrUsername: string) {
  if (!idOrUsername) return idOrUsername;
  if (idOrUsername.startsWith('@')) return idOrUsername;
  if (idOrUsername.startsWith('-100')) return idOrUsername;
  return `@${idOrUsername}`;
}

async function notify(msg: string) {
  try {
    await bot.sendMessage(normalizeDest(TG_DEST), msg, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('Telegram error', err);
  }
}

function safeStringify(obj: any, space = 2) {
  return JSON.stringify(
    obj,
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    space
  );
}

async function notifyJSON(title: string, obj: any) {
  try {
    const json = safeStringify(obj, 2);
    const CHUNK = 3500;
    if (json.length <= CHUNK) {
      await notify(`*${title}*\n\`\`\`\n${json}\n\`\`\``);
    } else {
      await notify(`*${title}* (parçalı)`);
      for (let i = 0; i < json.length; i += CHUNK) {
        const part = json.slice(i, i + CHUNK);
        await notify(`\`\`\`\n${part}\n\`\`\``);
      }
    }
  } catch (e: any) {
    await notify(`⚠️ ${title} stringify hatası: ${e?.message || e}`);
  }
}

// ---------- Zora API ----------
interface CreatorCoin {
  address: string;
  symbol: string;
  name: string;
  marketCap: string;
}

interface Profile {
  displayName?: string;
  handle?: string;
  creatorCoin?: CreatorCoin;
}

async function getProfileWithKey(identifier: string, apiKey: string): Promise<Profile | null> {
  const res = await fetch(
    `https://api-sdk.zora.engineering/profile?identifier=${identifier}`,
    {
      headers: {
        accept: 'application/json',
        ...(apiKey && { 'x-api-key': apiKey }),
      },
    },
  );
  if (!res.ok) throw new Error(`Zora API error: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { profile?: Profile };
  return json.profile ?? null;
}

// ---------- Clients ----------
function createClients(apiKey: string, privateKey: `0x${string}`) {
  setApiKey(apiKey);
  const account = privateKeyToAccount(privateKey);
  return {
    account,
    walletClient: createWalletClient({ chain: base, transport: http(HTTP_RPC), account }),
    publicClient: createPublicClient({ chain: base, transport: http(HTTP_RPC) }),
  };
}

// ---------- Alım işlemi ----------
async function checkAndBuyFor(cfg: BotConfig): Promise<boolean> {
  try {
    const profile = await getProfileWithKey(TARGET, cfg.apiKey);
    if (!profile || !profile.creatorCoin) return false;

    const coin = profile.creatorCoin.address;
    const symbol = profile.creatorCoin.symbol || 'Unknown';
    if (cfg.lastBoughtCoin === coin) return false;

    await notify(`🔎 ${cfg.name}: Creator Coin bulundu *${symbol}* \`${coin}\``);

    const { account, walletClient, publicClient } = createClients(cfg.apiKey, cfg.privateKey);
    const amountIn = parseEther(cfg.amountEth.toString());

    await notify(`🤖 ${cfg.name}: *${cfg.amountEth} ETH* → *${symbol}* alımı denenecek`);
    const receipt = await tradeCoin({
      tradeParameters: {
        sell: { type: 'eth' },
        buy: { type: 'erc20', address: coin },
        amountIn,
        slippage: 0.9,
        sender: account.address,
      },
      walletClient,
      account,
      publicClient,
    });

    cfg.lastBoughtCoin = coin;

    await notify(`✅ ${cfg.name}: Alım başarılı!\nTx: https://basescan.org/tx/${receipt.transactionHash}`);
    return true;
  } catch (err: any) {
    await notify(`❌ ${cfg.name} hata: ${err?.message || err}`);
    return false;
  }
}

// ---------- Retry logic ----------
async function buyUntilSuccess(cfg: BotConfig, maxRetries = 10): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    const didBuy = await checkAndBuyFor(cfg);
    if (didBuy) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

// ---------- Main ----------
async function main() {
  await notify('Bot başladı (tek cüzdan modu)');

  setInterval(async () => {
    if (!walletDone) {
      const ok = await buyUntilSuccess(botConfig);
      if (ok) walletDone = true;
    }

    tickCount++;
    if (tickCount % 30 === 0) {
      await notify(`⏳ Durum: coin=${botConfig.lastBoughtCoin ?? 'yok'}`);
    }

    if (walletDone) {
      await notify('🎉 Alım başarılı. Bot kapanıyor.');
      process.exit(0);
    }
  }, 30_000);
}

process.on('unhandledRejection', async (reason: any) => {
  console.error('Unhandled Rejection:', reason);
  await notify(`❌ Unhandled Rejection: ${safeStringify(reason)}`);
});
process.on('uncaughtException', async (err: any) => {
  console.error('Uncaught Exception:', err);
  await notify(`❌ Uncaught Exception: ${safeStringify(err)}`);
});

main();
