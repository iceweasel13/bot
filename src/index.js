import 'dotenv/config';
import { createPublicClient, createWalletClient, http, webSocket, parseEther, getAddress, decodeEventLog } from 'viem';
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
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
// ---------- Clients ----------
setApiKey(ZORA_API_KEY);
const publicClient = createPublicClient({ chain: base, transport: http(HTTP_RPC) });
const wsPublic = createPublicClient({ chain: base, transport: webSocket(WSS_RPC) });
const account = privateKeyToAccount(PRIV);
const walletClient = createWalletClient({ chain: base, transport: http(HTTP_RPC), account });
const bot = new TelegramBot(TG_TOKEN, { polling: false });
async function notify(msg) {
    try {
        await bot.sendMessage(TG_CHAT, msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
    }
    catch (err) {
        console.error('Telegram error', err);
    }
}
// ---------- Factory ABI ----------
const FACTORY = '0x777777751622c0d3258f214F9DF38E35BF45baF3'; // Base CreatorCoinFactory
const factoryAbi = [{
        type: 'event',
        name: 'CreatorCoinCreated',
        inputs: [
            { indexed: true, name: 'caller', type: 'address' },
            { indexed: false, name: 'coin', type: 'address' },
            { indexed: false, name: 'name', type: 'string' },
            { indexed: false, name: 'symbol', type: 'string' },
        ]
    }];
// ---------- Watcher ----------
async function watchJesse() {
    await notify(`👀 Jesse adresi izleniyor: ${TARGET}`);
    wsPublic.watchEvent({
        address: FACTORY,
        event: factoryAbi[0], // Assuming CreatorCoinCreated is the first event in the ABI
        args: { caller: TARGET },
        onLogs: async (logs) => {
            for (const log of logs) {
                const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
                const { caller, coin, name, symbol } = decoded.args;
                await notify(`🚀 Jesse coin açtı!\n• Coin: ${coin}\n• Ad: ${name} | Sembol: ${symbol}`);
                // ETH -> CreatorCoin swap
                try {
                    const amountIn = parseEther(AUTOBUY_ETH.toString());
                    await notify(`🤖 Otomatik alım: ${AUTOBUY_ETH} ETH → ${symbol}`);
                    const receipt = await tradeCoin({
                        tradeParameters: {
                            sell: { type: 'eth' },
                            buy: { type: 'erc20', address: coin },
                            amountIn,
                            slippage: 0.1,
                            sender: account.address,
                        },
                        walletClient,
                        account,
                        publicClient,
                    });
                    await notify(`✅ Alım tx: https://basescan.org/tx/${receipt.transactionHash}`);
                }
                catch (err) {
                    await notify(`❌ Alım hata: ${err?.message || err}`);
                }
            }
        },
    });
}
async function main() {
    await notify('🧠 Bot başlatıldı…');
    await watchJesse();
}
main().catch(async (err) => {
    console.error(err);
    await notify(`Bot hata: ${err.message || err}`);
});
//# sourceMappingURL=index.js.map