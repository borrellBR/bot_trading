import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import pako from 'pako';

@Injectable({
  providedIn: 'root'
})
export class ExchangeDataService {
  private sockets: { [key: string]: WebSocketSubject<any> } = {};
  private spotPriceSubjects: { [key: string]: BehaviorSubject<any> } = {};
  private futuresPriceSubjects: { [key: string]: BehaviorSubject<any> } = {};
  private isInitialized = false;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private http: HttpClient
  ) { }

  initialize() {
    if (this.isInitialized) return;
    if (isPlatformBrowser(this.platformId)) {
      this.connectToExchanges();
      this.isInitialized = true;
    }
  }

  private connectToExchanges() {
    const exchanges = [
      {
        name: 'Binance',
        spotUrl: 'wss://stream.binance.com:9443/ws/btcusdt@trade',
        futuresUrl: 'wss://fstream.binance.com/ws/btcusdt_250627@markPrice',
        futuresSymbol: 'BTCUSDT_250627',
        expirationDate: '2025-06-27'
      },
      {
        name: 'Kraken',
        spotUrl: 'wss://ws.kraken.com',
        futuresUrl: 'wss://futures.kraken.com/websockets/v1/public',
        futuresSymbol: 'PI_XBTUSD_250627',
        expirationDate: '2025-06-27'
      },
      {
        name: 'Coinbase',
        spotUrl: 'wss://ws-feed.exchange.coinbase.com',
        futuresUrl: null,
        futuresSymbol: null,
        expirationDate: null
      },
      {
        name: 'Bitfinex',
        spotUrl: 'wss://api-pub.bitfinex.com/ws/2',
        futuresUrl: 'wss://api-pub.bitfinex.com/ws/2',
        futuresSymbol: 'BTCF0:USTF0',
        expirationDate: '2025-06-27'
      },
      {
        name: 'OKX',
        spotUrl: 'wss://ws.okx.com:8443/ws/v5/public',
        futuresUrl: 'wss://ws.okx.com:8443/ws/v5/public',
        futuresSymbol: 'BTC-USDT-250627',
        expirationDate: '2025-06-27'
      },
      {
        // Ajustamos aquí para KuCoin con el contrato XBTMM25
        name: 'KuCoin',
        spotUrl: null,
        futuresUrl: 'wss://ws-api-futures.kucoin.com',
        futuresSymbol: 'XBTMM25', // <--- ESTE es el que ves en la URL
        expirationDate: '2025-06-27'
      }
    ];

    exchanges.forEach(exchange => {
      // BehaviorSubjects iniciales
      this.spotPriceSubjects[exchange.name] = new BehaviorSubject<any>({
        price: 0,
        expirationDate: exchange.expirationDate
      });
      this.futuresPriceSubjects[exchange.name] = new BehaviorSubject<any>({
        price: 0,
        expirationDate: exchange.expirationDate
      });

      // SPOT
      if (exchange.spotUrl && exchange.name !== 'KuCoin') {
        this.createSpotWebSocket(exchange.name, exchange.spotUrl);
      } else if (exchange.name === 'KuCoin') {
        this.connectKuCoinSpot(); // Spot KuCoin vía bullet
      }

      // FUTURES
      if (exchange.futuresUrl && exchange.futuresSymbol && exchange.name !== 'KuCoin') {
        this.createFuturesWebSocket(exchange.name, exchange.futuresUrl, exchange.futuresSymbol);
      } else if (exchange.name === 'KuCoin' && exchange.futuresUrl && exchange.futuresSymbol) {
        this.connectKuCoinFutures(exchange.futuresUrl, exchange.futuresSymbol);
      }
    });
  }

  // ----------------------------------------------------------------
  // SPOT normal
  // ----------------------------------------------------------------
  private createSpotWebSocket(exchangeName: string, url: string) {
    this.sockets[`${exchangeName}_spot`] = webSocket({
      url,
      openObserver: {
        next: () => {
          console.log(`${exchangeName} spot WebSocket conectado`);
          const subMsg = this.getSpotSubscriptionMessage(exchangeName);
          if (subMsg) {
            console.log(`[${exchangeName} SPOT] -> Enviando suscripción`, subMsg);
            this.sockets[`${exchangeName}_spot`].next(subMsg);
          }
        }
      },
      closeObserver: {
        next: () => {
          console.warn(`${exchangeName}_spot websocket cerrado`);
        }
      }
    });

    this.sockets[`${exchangeName}_spot`].subscribe({
      next: msg => this.handleSpotPrice(exchangeName, msg),
      error: err => console.error(`${exchangeName}_spot error:`, err)
    });
  }

  // ----------------------------------------------------------------
  // FUTURES normal
  // ----------------------------------------------------------------
  private createFuturesWebSocket(exchangeName: string, url: string, futuresSymbol: string) {
    this.sockets[`${exchangeName}_futures`] = webSocket({
      url,
      openObserver: {
        next: () => {
          console.log(`${exchangeName} futures WebSocket conectado`);
          const subMsg = this.getFuturesSubscriptionMessage(exchangeName, futuresSymbol);
          if (subMsg) {
            console.log(`[${exchangeName} FUTURES] -> Enviando subscripción`, subMsg);
            this.sockets[`${exchangeName}_futures`].next(subMsg);
          }
        }
      },
      closeObserver: {
        next: () => {
          console.warn(`${exchangeName}_futures websocket cerrado`);
        }
      }
    });

    this.sockets[`${exchangeName}_futures`].subscribe({
      next: msg => this.handleFuturesPrice(exchangeName, msg),
      error: err => console.error(`${exchangeName}_futures error:`, err)
    });
  }

  // ----------------------------------------------------------------
  // KuCoin SPOT (NO TOCAR)
  // ----------------------------------------------------------------
  private connectKuCoinSpot() {
    // Ajusta tu endpoint / proxy si corresponde
    this.http.post('/kucoin-api/api/v1/bullet-public', {}).subscribe({
      next: (res: any) => {
        if (!res?.data?.instanceServers?.length) {
          console.error('[KuCoin Spot] No se obtuvieron instanceServers:', res);
          return;
        }
        const { token, instanceServers } = res.data;
        const endpoint = instanceServers[0].endpoint;
        const wsUrl = `${endpoint}?token=${token}&connectId=${Date.now()}`;

        this.sockets['KuCoin_spot'] = webSocket({
          url: wsUrl,
          openObserver: {
            next: () => {
              console.log('[KuCoin Spot] Conectado');
              const subMsg = {
                id: Date.now(),
                type: 'subscribe',
                topic: '/market/ticker:BTC-USDT',
                privateChannel: false,
                response: true
              };
              this.sockets['KuCoin_spot'].next(subMsg);

              setInterval(() => {
                this.sockets['KuCoin_spot'].next({
                  id: Date.now(),
                  type: 'ping'
                });
              }, 25000);
            }
          },
          closeObserver: {
            next: () => {
              console.warn('[KuCoin Spot] websocket cerrado');
            }
          }
        });

        this.sockets['KuCoin_spot'].subscribe({
          next: msg => this.handleSpotPrice('KuCoin', msg),
          error: err => console.error('[KuCoin Spot] Error:', err)
        });
      },
      error: err => console.error('[KuCoin Spot] bullet-public error:', err)
    });
  }

  // ----------------------------------------------------------------
  // KuCoin FUTURES
  // ----------------------------------------------------------------
  private connectKuCoinFutures(url: string, futuresSymbol: string) {
    console.log('[KuCoin Futures] Iniciando bullet-public...');
    this.http.post('https://api-futures.kucoin.com/api/v1/bullet-public', {}).subscribe({
      next: (res: any) => {
        if (!res?.data?.instanceServers?.length) {
          console.error('[KuCoin Futures] No se obtuvieron instanceServers:', res);
          return;
        }

        const { token, instanceServers } = res.data;
        const endpoint = instanceServers[0].endpoint;
        const wsUrl = `${endpoint}?token=${token}&connectId=${Date.now()}`;

        console.log('[KuCoin Futures] Conectando WS ->', wsUrl);

        this.sockets['KuCoin_futures'] = webSocket({
          url: wsUrl,
          binaryType: 'arraybuffer', // Manejo binario
          deserializer: ({ data }) => {
            // Si llega como string, parsea normal
            if (typeof data === 'string') {
              return JSON.parse(data);
            } else {
              // Si llega comprimido (ArrayBuffer), descomprime con pako
              try {
                const text = pako.inflate(new Uint8Array(data), { to: 'string' });
                return JSON.parse(text);
              } catch (err) {
                console.error('[KuCoin Futures] Error descomprimiendo:', err);
                return {};
              }
            }
          },
          openObserver: {
            next: () => {
              console.log('[KuCoin Futures] WS conectado');
              // Importante: usar EXACTAMENTE "/contractMarket/ticker:XBTMM25"
              const subMsg = {
                id: Date.now(),
                type: 'subscribe',
                topic: `/contractMarket/ticker:${futuresSymbol}`,
                privateChannel: false,
                response: true
              };
              console.log('[KuCoin Futures] -> Enviando suscripción:', subMsg);
              this.sockets['KuCoin_futures'].next(subMsg);

              // Ping periódico
              setInterval(() => {
                const ping = {
                  id: Date.now(),
                  type: 'ping'
                };
                this.sockets['KuCoin_futures'].next(ping);
              }, 25000);
            }
          },
          closeObserver: {
            next: () => {
              console.warn('[KuCoin Futures] websocket cerrado');
            }
          }
        });

        this.sockets['KuCoin_futures'].subscribe({
          next: msg => this.handleFuturesPrice('KuCoin', msg),
          error: err => console.error('[KuCoin_futures error]:', err)
        });
      },
      error: err => console.error('[KuCoin Futures] bullet-public error:', err)
    });
  }

  // ----------------------------------------------------------------
  // GETTERS
  // ----------------------------------------------------------------
  getSpotPrice(exchange: string): Observable<any> {
    return this.spotPriceSubjects[exchange]?.asObservable() || new Observable();
  }

  getFuturesPrice(exchange: string): Observable<any> {
    return this.futuresPriceSubjects[exchange]?.asObservable() || new Observable();
  }

  // ----------------------------------------------------------------
  // Subscripción SPOT
  // ----------------------------------------------------------------
  private getSpotSubscriptionMessage(exchange: string): any {
    switch (exchange) {
      case 'Binance':
        // Nada, Binance ya suscrito en la URL
        return null;
      case 'Kraken':
        return {
          event: 'subscribe',
          pair: ['XBT/USD'],
          subscription: { name: 'ticker' }
        };
      case 'Coinbase':
        return {
          type: 'subscribe',
          product_ids: ['BTC-USD'],
          channels: ['ticker']
        };
      case 'Bitfinex':
        return {
          event: 'subscribe',
          channel: 'ticker',
          symbol: 'tBTCUSD'
        };
      case 'OKX':
        return {
          op: 'subscribe',
          args: [
            {
              channel: 'tickers',
              instId: 'BTC-USDT'
            }
          ]
        };
      default:
        return null;
    }
  }

  // ----------------------------------------------------------------
  // Subscripción FUTURES
  // ----------------------------------------------------------------
  private getFuturesSubscriptionMessage(exchange: string, futuresSymbol: string): any {
    switch (exchange) {
      case 'Binance':
        return {
          method: 'SUBSCRIBE',
          params: [`${futuresSymbol.toLowerCase()}@markPrice`],
          id: 1
        };
      case 'Kraken':
        return {
          event: 'subscribe',
          product_ids: [futuresSymbol],
          channels: ['ticker']
        };
      case 'Bitfinex':
        return {
          event: 'subscribe',
          channel: 'ticker',
          symbol: futuresSymbol
        };
      case 'OKX':
        return {
          op: 'subscribe',
          args: [
            {
              channel: 'mark-price',
              instId: futuresSymbol
            }
          ]
        };
      default:
        return null;
    }
  }

  // ----------------------------------------------------------------
  // handleSpotPrice
  // ----------------------------------------------------------------
  private handleSpotPrice(exchange: string, msg: any) {
    const oldPrice = this.spotPriceSubjects[exchange].value.price;
    let price = oldPrice;

    switch (exchange) {
      case 'Binance':
        if (msg?.p) {
          price = parseFloat(msg.p);
        }
        break;
      case 'Kraken':
        if (Array.isArray(msg) && msg[1]?.c) {
          price = parseFloat(msg[1].c[0]);
        }
        break;
      case 'Coinbase':
        if (msg?.type === 'ticker' && msg?.price) {
          price = parseFloat(msg.price);
        }
        break;
      case 'Bitfinex':
        if (Array.isArray(msg) && Array.isArray(msg[1])) {
          const lastPrice = msg[1][6];
          if (lastPrice) {
            price = parseFloat(lastPrice);
          }
        }
        break;
      case 'OKX':
        if (msg?.arg?.channel === 'tickers' && msg?.data?.[0]?.last) {
          price = parseFloat(msg.data[0].last);
        }
        break;
      case 'KuCoin':
        // /market/ticker:BTC-USDT
        if (msg?.topic?.includes('BTC-USDT') && msg?.data?.price) {
          price = parseFloat(msg.data.price);
        }
        break;
    }

    this.spotPriceSubjects[exchange].next({ price });
  }

  // ----------------------------------------------------------------
  // handleFuturesPrice
  // ----------------------------------------------------------------
  private handleFuturesPrice(exchange: string, msg: any) {
    console.log(`[Futures ${exchange}]`, msg);

    const oldPrice = this.futuresPriceSubjects[exchange].value.price;
    let price = oldPrice;

    switch (exchange) {
      case 'Binance':
        if (msg?.p) {
          price = parseFloat(msg.p);
        }
        break;
      case 'Kraken':
        if (Array.isArray(msg) && msg[1]?.c) {
          price = parseFloat(msg[1].c[0]);
        }
        break;
      case 'Bitfinex':
        if (Array.isArray(msg) && Array.isArray(msg[1])) {
          const lastPrice = msg[1][6];
          if (lastPrice) {
            price = parseFloat(lastPrice);
          }
        }
        break;
      case 'OKX':
        if (msg?.arg?.channel === 'mark-price' && msg?.data?.[0]?.markPx) {
          price = parseFloat(msg.data[0].markPx);
        }
        break;
      case 'KuCoin':
        // Revisa el topic con "ticker:XBTMM25"
        if (msg?.topic?.includes('ticker:XBTMM25') && msg?.data?.price) {
          price = parseFloat(msg.data.price);
        }
        break;
    }

    this.futuresPriceSubjects[exchange].next({ price });
  }
}
