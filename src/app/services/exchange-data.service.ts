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

  connectToExchanges() {
    const exchanges = [
      // BINANCE
      {
        name: 'Binance',
        spotUrl: 'wss://stream.binance.com:9443/ws/btcusdt@trade',
        futuresUrl: 'wss://fstream.binance.com/ws/BTCUSDT_250630@markPrice'
      },
      // KRAKEN
      {
        name: 'Kraken',
        spotUrl: 'wss://ws.kraken.com',
        futuresUrl: null
      },
      // COINBASE
      {
        name: 'Coinbase',
        spotUrl: 'wss://ws-feed.exchange.coinbase.com',
        futuresUrl: null
      },
      // BITFINEX
      {
        name: 'Bitfinex',
        spotUrl: 'wss://api-pub.bitfinex.com/ws/2',
        futuresUrl: null
      },
      // OKX
      {
        name: 'OKX',
        spotUrl: 'wss://ws.okx.com:8443/ws/v5/public',
        futuresUrl: null
      },
      // KUCOIN (manejado aparte)
      {
        name: 'KuCoin',
        spotUrl: null,
        futuresUrl: null
      },
      // DERIBIT (no hay spot real, pero suscribimos a BTC-PERPETUAL para tener un precio
      // Bybit y Gate.io los removemos
    ];

    // Creamos BehaviorSubjects para cada exchange
    exchanges.forEach(exchange => {
      this.spotPriceSubjects[exchange.name] = new BehaviorSubject<any>({ price: 0 });
      this.futuresPriceSubjects[exchange.name] = new BehaviorSubject<any>({ price: 0 });

      // Conexión SPOT (si no es KuCoin)
      if (exchange.spotUrl && exchange.name !== 'KuCoin') {
        this.createSpotWebSocket(exchange.name, exchange.spotUrl);
      }
      // Conexión FUTURES
      if (exchange.futuresUrl) {
        this.createFuturesWebSocket(exchange.name, exchange.futuresUrl);
      }
      // KuCoin se maneja aparte
      if (exchange.name === 'KuCoin') {
        this.connectKuCoinSpot();
      }
    });
  }

  /**
   * Crea la conexión SPOT.
   * - Huobi -> binario + gzip
   * - Deribit -> JSON-RPC
   * - Resto -> conexión estándar
   */
  private createSpotWebSocket(exchangeName: string, url: string) {
    // HUOBI
    if (exchangeName === 'Huobi') {
      this.sockets['Huobi_spot'] = webSocket<ArrayBuffer | string>({
        url,
        binaryType: 'arraybuffer',
        deserializer: e => e.data,
        openObserver: {
          next: () => {
            console.log('Huobi spot WebSocket conectado');
            const subscriptionMsg = this.getSpotSubscriptionMessage('Huobi');
            if (subscriptionMsg) {
              this.sockets['Huobi_spot'].next(subscriptionMsg);
            }
          }
        },
        closeObserver: {
          next: () => {
            console.warn('Huobi_spot websocket cerrado');
          }
        }
      });

      this.sockets['Huobi_spot'].subscribe({
        next: raw => {
          try {
            let msg: any;
            if (typeof raw === 'string') {
              msg = JSON.parse(raw);
            } else {
              const text = pako.inflate(raw, { to: 'string' });
              msg = JSON.parse(text);
            }
            console.log('[Huobi] Mensaje recibido:', msg); // <-- Para debug

            // Ping/pong
            if (msg?.ping) {
              this.sockets['Huobi_spot'].next({ pong: msg.ping });
            }
            this.handleSpotPrice('Huobi', msg);
          } catch (e) {
            console.error('Huobi_spot error parseando:', e);
          }
        },
        error: err => console.error('Huobi_spot error:', err)
      });

      // DERIBIT (JSON-RPC)
    } else if (exchangeName === 'Deribit') {
      this.sockets['Deribit_spot'] = webSocket({
        url,
        openObserver: {
          next: () => {
            console.log('Deribit spot WebSocket conectado');
            // Suscribirse a "ticker.BTC-PERPETUAL.raw"
            const subMsg = this.getSpotSubscriptionMessage('Deribit');
            this.sockets['Deribit_spot'].next(subMsg);
          }
        },
        closeObserver: {
          next: () => {
            console.warn('Deribit_spot websocket cerrado');
          }
        }
      });

      this.sockets['Deribit_spot'].subscribe({
        next: msg => {
          console.log('[Deribit] Mensaje recibido:', msg); // <-- Para debug
          this.handleSpotPrice('Deribit', msg);
        },
        error: err => console.error('Deribit_spot error:', err)
      });

      // Resto (Binance, Kraken, Coinbase, Bitfinex, OKX)
    } else {
      this.sockets[`${exchangeName}_spot`] = webSocket({
        url,
        openObserver: {
          next: () => {
            console.log(`${exchangeName} spot WebSocket conectado`);
            const subscriptionMsg = this.getSpotSubscriptionMessage(exchangeName);
            if (subscriptionMsg) {
              this.sockets[`${exchangeName}_spot`].next(subscriptionMsg);
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
        next: msg => {
          console.log(`[${exchangeName}] Mensaje recibido:`, msg); // Debug
          this.handleSpotPrice(exchangeName, msg);
        },
        error: err => console.error(`${exchangeName}_spot error:`, err)
      });
    }
  }

  /**
   * Conexión FUTURES genérica (ej. Binance)
   */
  private createFuturesWebSocket(exchangeName: string, url: string) {
    this.sockets[`${exchangeName}_futures`] = webSocket({
      url,
      openObserver: {
        next: () => {
          console.log(`${exchangeName} futures WebSocket conectado`);
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

  /**
   * KuCoin Spot (handshake + pings)
   */
  private connectKuCoinSpot() {
    this.http.post('/kucoin-api/api/v1/bullet-public', {})
      .subscribe((res: any) => {
        if (!res?.data?.instanceServers?.length) {
          console.error('No se obtuvieron instanceServers de KuCoin', res);
          return;
        }
        const { token, instanceServers } = res.data;
        const endpoint = instanceServers[0].endpoint;
        const wsUrl = `${endpoint}?token=${token}&connectId=${Date.now()}`;

        this.sockets['KuCoin_spot'] = webSocket({
          url: wsUrl,
          openObserver: {
            next: () => {
              console.log('KuCoin spot WebSocket conectado');
              const subMsg = {
                id: Date.now(),
                type: 'subscribe',
                topic: '/market/ticker:BTC-USDT',
                privateChannel: false,
                response: true
              };
              this.sockets['KuCoin_spot'].next(subMsg);
              setInterval(() => {
                this.sockets['KuCoin_spot'].next({ id: Date.now(), type: 'ping' });
              }, 25000);
            }
          },
          closeObserver: {
            next: () => console.warn('KuCoin_spot websocket cerrado')
          }
        });

        this.sockets['KuCoin_spot'].subscribe({
          next: msg => this.handleSpotPrice('KuCoin', msg),
          error: err => console.error('KuCoin_spot error:', err)
        });
      }, err => console.error('Error al obtener bullet-public de KuCoin:', err));
  }

  /* Observables para uso en tus componentes */
  getSpotPrice(exchange: string): Observable<any> {
    return this.spotPriceSubjects[exchange]?.asObservable() || new Observable();
  }

  getFuturesPrice(exchange: string): Observable<any> {
    return this.futuresPriceSubjects[exchange]?.asObservable() || new Observable();
  }

  /**
   * Devuelve el payload de suscripción SPOT según el exchange
   */
  private getSpotSubscriptionMessage(exchange: string): any {
    switch (exchange) {
      case 'Binance':
        // Ya conectado a btcusdt@trade
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
          args: [{ channel: 'tickers', instId: 'BTC-USDT' }]
        };
      case 'Huobi':
        // Recomendado: "market.btcusdt.detail.merged" => da "tick.close"
        return {
          sub: 'market.btcusdt.detail.merged',
          id: 'myHuobiTicker'
        };
      case 'Deribit':
        // JSON-RPC, suscribimos a "ticker.BTC-PERPETUAL.raw"
        return {
          jsonrpc: '2.0',
          id: 1,
          method: 'public/subscribe',
          params: {
            channels: ['ticker.BTC-PERPETUAL.raw']
          }
        };
      default:
        return null;
    }
  }

  /**
   * Procesar mensaje SPOT y extraer último precio
   */
  private handleSpotPrice(exchange: string, msg: any) {
    // Tomar el precio previo para no resetear a 0 si no viene
    const oldPrice = this.spotPriceSubjects[exchange].value.price;
    let price = oldPrice;

    switch (exchange) {
      case 'Binance':
        // { p: "12345.67", ... }
        if (msg?.p) price = parseFloat(msg.p);
        break;
      case 'Kraken':
        // A veces envía un heartbeat sin c
        // [chanId, {c:["12345.6","1","1.000"]}, "ticker", "XBT/USD"]
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
        // [chanId, [BID, BID_SIZE, ASK, ASK_SIZE, ..., LAST_PRICE, ...]]
        if (Array.isArray(msg) && Array.isArray(msg[1])) {
          const lastPrice = msg[1][6];
          if (lastPrice) price = parseFloat(lastPrice);
        }
        break;
      case 'OKX':
        // { arg: {channel:'tickers', instId:'BTC-USDT'}, data:[{last:'12345.67'}] }
        if (msg?.arg?.channel === 'tickers' && msg?.data?.[0]?.last) {
          price = parseFloat(msg.data[0].last);
        }
        break;
      case 'Huobi':
        // { ch:'market.btcusdt.detail.merged', tick:{ close:12345.67, ... } }
        if (msg?.ch?.includes('btcusdt') && msg?.tick?.close) {
          price = parseFloat(msg.tick.close);
        }
        break;
      case 'KuCoin':
        // { topic:'...ticker:BTC-USDT', data:{price:'12345.67'} }
        if (msg?.topic?.includes('ticker:BTC-USDT') && msg?.data?.price) {
          price = parseFloat(msg.data.price);
        }
        break;
      case 'Deribit':
        // { method:'subscription', params:{channel:'ticker.BTC-PERPETUAL.raw', data:{last_price:12345.6}}}
        if (msg?.method === 'subscription' && msg?.params?.data?.last_price) {
          price = parseFloat(msg.params.data.last_price);
        }
        break;
    }

    this.spotPriceSubjects[exchange].next({ price });
  }

  /**
   * Procesar mensaje FUTURES (ej. Binance)
   */
  private handleFuturesPrice(exchange: string, msg: any) {
    const oldPrice = this.futuresPriceSubjects[exchange].value.price;
    let price = oldPrice;

    switch (exchange) {
      case 'Binance':
        if (msg?.p) {
          price = parseFloat(msg.p);
        }
        break;
      // Podrías añadir OKX, etc. si lo deseas
    }
    this.futuresPriceSubjects[exchange].next({ price });
  }
}
