import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseEther, } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import TelegramBot from 'node-telegram-bot-api';
import { setApiKey, tradeCoin } from '@zoralabs/coins-sdk';
// ---------- ENV yardımcıları ----------
function requireEnv(name) {
    const v = process.env[name];
    if (!v || !String(v).trim()) {
        console.error(`Missing required env: ${name}`);
        process.exit(1);
    }
    return String(v).trim();
}
let tickCount = 0;
function normalizePrivateKey(raw) {
    let k = raw.trim();
    if (!k.startsWith('0x') && !k.startsWith('0X'))
        k = `0x${k}`;
    if (!(k.length === 66 && /^0x[0-9a-fA-F]{64}$/.test(k))) {
        console.error('PRIVATE_KEY must be 0x-prefixed 64-hex string.');
        process.exit(1);
    }
    return k;
}
// ---------- Config ----------
const HTTP_RPC = requireEnv('BASE_HTTP_RPC');
const TARGET = requireEnv('TARGET_WALLET'); // ENS veya adres
const TG_TOKEN = requireEnv('TELEGRAM_BOT_TOKEN');
const TG_DEST = (() => {
    const v = process.env.TELEGRAM_CHANNEL || process.env.TELEGRAM_CHAT_ID;
    if (!v || !String(v).trim()) {
        console.error('Missing required env: TELEGRAM_CHANNEL or TELEGRAM_CHAT_ID');
        process.exit(1);
    }
    return String(v).trim();
})();
// iki cüzdan için konfig
const bots = [
    {
        name: 'Wallet1',
        apiKey: requireEnv('ZORA_API_KEY_1'),
        privateKey: normalizePrivateKey(requireEnv('PRIVATE_KEY_1')),
        amountEth: parseFloat(process.env.AUTOBUY_ETH_1 || '0.05'),
        lastBoughtCoin: null,
    },
    {
        name: 'Wallet2',
        apiKey: requireEnv('ZORA_API_KEY_2'),
        privateKey: normalizePrivateKey(requireEnv('PRIVATE_KEY_2')),
        amountEth: parseFloat(process.env.AUTOBUY_ETH_2 || '0.009'),
        lastBoughtCoin: null,
    },
];
// ---------- Telegram ----------
const bot = new TelegramBot(TG_TOKEN, { polling: false });
function normalizeDest(idOrUsername) {
    if (!idOrUsername)
        return idOrUsername;
    if (idOrUsername.startsWith('@'))
        return idOrUsername;
    if (idOrUsername.startsWith('-100'))
        return idOrUsername;
    return `@${idOrUsername}`;
}
async function notify(msg) {
    try {
        await bot.sendMessage(normalizeDest(TG_DEST), msg, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
        });
    }
    catch (err) {
        console.error('Telegram error', err);
    }
}
// BigInt güvenli stringify + uzun mesajları parçalayıp gönder
function safeStringify(obj, space = 2) {
    return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), space);
}
async function notifyJSON(title, obj) {
    try {
        const json = safeStringify(obj, 2);
        // Telegram mesaj limitine (~4096) takılmamak için parça parça gönder
        const CHUNK = 3500;
        if (json.length <= CHUNK) {
            await notify(`*${title}*\n\`\`\`\n${json}\n\`\`\``);
        }
        else {
            await notify(`*${title}* (parçalı)`);
            for (let i = 0; i < json.length; i += CHUNK) {
                const part = json.slice(i, i + CHUNK);
                await notify(`\`\`\`\n${part}\n\`\`\``);
            }
        }
    }
    catch (e) {
        await notify(`⚠️ ${title} stringify hatası: ${e?.message || e}`);
    }
}
async function getProfileWithKey(identifier, apiKey) {
    const res = await fetch(`https://api-sdk.zora.engineering/profile?identifier=${identifier}`, {
        headers: {
            accept: 'application/json',
            ...(apiKey && { 'x-api-key': apiKey }),
        },
    });
    if (!res.ok)
        throw new Error(`Zora API error: ${res.status} ${await res.text()}`);
    const json = (await res.json());
    return json.profile ?? null;
}
// ---------- Clients ----------
function createClients(apiKey, privateKey) {
    setApiKey(apiKey);
    const account = privateKeyToAccount(privateKey);
    return {
        account,
        walletClient: createWalletClient({ chain: base, transport: http(HTTP_RPC), account }),
        publicClient: createPublicClient({ chain: base, transport: http(HTTP_RPC) }),
    };
}
// ---------- Creator Coin kontrol ve alım ----------
async function checkAndBuyFor(cfg) {
    try {
        const profile = await getProfileWithKey(TARGET, cfg.apiKey);
        if (!profile || !profile.creatorCoin)
            return false; // sessiz geç
        const coin = profile.creatorCoin.address;
        const symbol = profile.creatorCoin.symbol || 'Unknown';
        if (cfg.lastBoughtCoin === coin)
            return false;
        // coin bulundu mesajı
        await notify(`🔎 ${cfg.name}: Creator Coin bulundu *${symbol}* \`${coin}\``);
        const { account, walletClient, publicClient } = createClients(cfg.apiKey, cfg.privateKey);
        const amountIn = parseEther(cfg.amountEth.toString());
        await notify(`🤖 ${cfg.name}: *${cfg.amountEth} ETH* → *${symbol}* alımı denenecek`);
        const receipt = await tradeCoin({
            tradeParameters: {
                sell: { type: 'eth' },
                buy: { type: 'erc20', address: coin },
                amountIn,
                slippage: 0.6,
                sender: account.address,
            },
            walletClient,
            account,
            publicClient,
        });
        cfg.lastBoughtCoin = coin;
        await notify(`✅ ${cfg.name}: Alım başarılı!\nTx: https://basescan.org/tx/${receipt.transactionHash}`);
        return true;
    }
    catch (err) {
        await notify(`❌ ${cfg.name} hata: ${err?.message || err}`);
        return false;
    }
}
// ---------- Retry logic ----------
async function buyUntilSuccess(cfg, maxRetries = 10) {
    for (let i = 0; i < maxRetries; i++) {
        const didBuy = await checkAndBuyFor(cfg);
        if (didBuy)
            return true;
        // eğer başarısızsa biraz bekleyip tekrar dene
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}
// ---------- Main ----------
async function main() {
    await notify('Bot başladı');
    setInterval(async () => {
        const ok1 = await buyUntilSuccess(bots[0]); // önce Wallet1 başarılı olana kadar
        const ok2 = await buyUntilSuccess(bots[1]); // sonra Wallet2
        tickCount++;
        if (tickCount % 30 === 0) { // 30 x 30sn = 15dk
            await notify(`⏳ Durum: Wallet1 coin=${bots[0].lastBoughtCoin ?? 'yok'}, Wallet2 coin=${bots[1].lastBoughtCoin ?? 'yok'}`);
        }
        // her iki cüzdan da başarılı olduysa botu durdur
        if (ok1 && ok2) {
            await notify('🎉 Her iki cüzdan da başarılı alım yaptı. Bot kapanıyor.');
            process.exit(0);
        }
    }, 30_000);
}
process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled Rejection:', reason);
    await notify(`❌ Unhandled Rejection: ${safeStringify(reason)}`);
});
process.on('uncaughtException', async (err) => {
    console.error('Uncaught Exception:', err);
    await notify(`❌ Uncaught Exception: ${safeStringify(err)}`);
});
main();
//# sourceMappingURL=index.js.map