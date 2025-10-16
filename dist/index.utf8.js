import 'dotenv/config';
import { createPublicClient, createWalletClient, http, webSocket, parseEther, getAddress, decodeEventLog, } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import TelegramBot from 'node-telegram-bot-api';
import { setApiKey, tradeCoin } from '@zoralabs/coins-sdk';
// ---------- ENV ----------
const HTTP_RPC = process.env.BASE_HTTP_RPC;
const WSS_RPC = process.env.BASE_WSS_RPC;
const ZORA_API_KEY = process.env.ZORA_API_KEY;
const PRIV = process.env.PRIVATE_KEY;
const TARGET = getAddress(process.env.TARGET_WALLET);
const AUTOBUY_ETH = parseFloat(process.env.AUTOBUY_ETH || '0.001');
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHANNEL = (process.env.TELEGRAM_CHANNEL || process.env.TELEGRAM_CHAT_ID);
// ---------- Clients ----------
setApiKey(ZORA_API_KEY);
const publicClient = createPublicClient({ chain: base, transport: http(HTTP_RPC) });
const wsPublic = createPublicClient({ chain: base, transport: webSocket(WSS_RPC) });
const account = privateKeyToAccount(PRIV);
const walletClient = createWalletClient({ chain: base, transport: http(HTTP_RPC), account });
const bot = new TelegramBot(TG_TOKEN, { polling: false });
async function notify(msg) {
    try {
        await bot.sendMessage(TG_CHANNEL, msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
    }
    catch (err) {
        console.error('Telegram error', err);
    }
}
// ---------- Factory ABI ----------
const FACTORY = '0x777777751622c0d3258f214F9DF38E35BF45baF3'; // Base CreatorCoinFactory
const factoryAbi = [
    {
        type: 'event',
        name: 'CreatorCoinCreated',
        inputs: [
            { indexed: true, name: 'caller', type: 'address' },
            { indexed: false, name: 'coin', type: 'address' },
            { indexed: false, name: 'name', type: 'string' },
            { indexed: false, name: 'symbol', type: 'string' },
        ],
    },
];
// ---------- Watcher ----------
async function watchFactory() {
    await notify(`ğŸ‘€ Factory izleniyor: ${FACTORY}`);
    wsPublic.watchEvent({
        address: FACTORY,
        event: { name: 'CreatorCoinCreated', abi: factoryAbi }, // â† doÄŸru format
        onLogs: async (logs) => {
            for (const log of logs) {
                try {
                    const decoded = decodeEventLog({
                        abi: factoryAbi,
                        data: log.data,
                        topics: log.topics,
                    });
                    const { caller, coin, name, symbol } = decoded.args;
                    await notify(`ğŸš€ Yeni coin yaratÄ±ldÄ±!\nâ€¢ Creator: ${caller}\nâ€¢ Coin: ${coin}\nâ€¢ Ad: ${name} | Sembol: ${symbol}`);
                    // Åimdilik sadece mesaj atÄ±yoruz, ileride if(caller===TARGET) ve tradeCoin kÄ±smÄ±nÄ± aÃ§arsÄ±n
                }
                catch (err) {
                    await notify(`âŒ Event decode hata: ${err?.message || err}`);
                }
            }
        },
    });
}
// ---------- Main ----------
async function main() {
    await notify('ğŸ§  Bot baÅŸlatÄ±ldÄ±â€¦');
    await watchFactory();
}
// Global hatalarÄ± da Telegramâ€™a at
process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled Rejection:', reason);
    await notify(`âŒ Unhandled Rejection: ${reason?.message || reason}`);
});
process.on('uncaughtException', async (err) => {
    console.error('Uncaught Exception:', err);
    await notify(`âŒ Uncaught Exception: ${err?.message || err}`);
});
main().catch(async (err) => {
    console.error(err);
    await notify(`Bot hata: ${err.message || err}`);
});
//# sourceMappingURL=index.utf8.js.map