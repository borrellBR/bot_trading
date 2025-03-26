import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';

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
    // Lista de exchanges.
    // Nota: para KuCoin, ya no ponemos directamente la url WebSocket
    // porque necesitamos primero hacer el handshake de Bullet.
    const exchanges = [
      {
        name: 'Binance',
        spotUrl: 'wss://stream.binance.com:9443/ws/btcusdt@trade',
        futuresUrl: 'wss://fstream.binance.com/ws/BTCUSDT_250630@markPrice'
      },
      {
        name: 'Bybit',
        spotUrl: 'wss://stream.bybit.com/v5/public/spot',
        futuresUrl: null
      },
      {
        name: 'Kraken',
        spotUrl: 'wss://ws.kraken.com',
        futuresUrl: null
      },
      {
        name: 'Coinbase',
        spotUrl: 'wss://ws-feed.exchange.coinbase.com',
        futuresUrl: null
      },
      {
        name: 'Bitfinex',
        spotUrl: 'wss://api-pub.bitfinex.com/ws/2',
        futuresUrl: null
      },
      {
        name: 'OKX',
        spotUrl: 'wss://ws.okx.com:8443/ws/v5/public',
        futuresUrl: null
      },
      {
        name: 'Huobi',
        spotUrl: 'wss://api.huobi.pro/ws',
        futuresUrl: null
      },
      {
        // KuCoin: NO poner spotUrl directo, sino manejarlo aparte
        name: 'KuCoin',
        spotUrl: null,  // O lo puedes omitir y hacer un if
        futuresUrl: null
      },
      {
        name: 'Gate.io',
        spotUrl: 'wss://ws.gate.io/v4/ws/usdt',
        futuresUrl: null
      }
    ];

    exchanges.forEach(exchange => {
      // Creamos los BehaviorSubject de precio SPOT y FUTURES
      this.spotPriceSubjects[exchange.name] = new BehaviorSubject<any>({ price: 0 });
      this.futuresPriceSubjects[exchange.name] = new BehaviorSubject<any>({ price: 0 });

      // Si no es KuCoin, conectamos normal
      if (exchange.spotUrl && exchange.name !== 'KuCoin') {
        this.createSpotWebSocket(exchange.name, exchange.spotUrl);
      }

      // FUTURES (si fuera el caso)
      if (exchange.futuresUrl) {
        this.createFuturesWebSocket(exchange.name, exchange.futuresUrl);
      }

      // KUCOIN: lo conectamos aparte
      if (exchange.name === 'KuCoin') {
        this.connectKuCoinSpot();
      }
    });
  }

  /**
   * Esta función crea la conexión SPOT normal (para la mayoría de exchanges).
   */
  private createSpotWebSocket(exchangeName: string, url: string) {
    this.sockets[`${exchangeName}_spot`] = webSocket({
      url,
      openObserver: {
        next: () => {
          console.log(`${exchangeName} spot WebSocket conectado`);
          // Mandar mensaje de suscripción si corresponde
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
      next: msg => this.handleSpotPrice(exchangeName, msg),
      error: err => console.error(`${exchangeName}_spot error:`, err)
    });
  }

  /**
   * Conexión FUTURES genérica
   */
  private createFuturesWebSocket(exchangeName: string, url: string) {
    this.sockets[`${exchangeName}_futures`] = webSocket({
      url,
      openObserver: {
        next: () => {
          console.log(`${exchangeName} futures WebSocket conectado`);
          // Suscripción si hace falta
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
   * KUCOIN Spot requiere:
   * 1) Llamar a POST /api/v1/bullet-public para obtener token y endpoint.
   * 2) Conectar via WebSocket a ese endpoint + token=...
   * 3) Enviar pings periódicos.
   * 4) Suscribirse al topic deseado.
   */
  private connectKuCoinSpot() {
    this.http.post('/kucoin-api/api/v1/bullet-public', {})
      .subscribe((res: any) => {
        if (!res?.data?.instanceServers?.length) {
          console.error('No se obtuvieron instanceServers de KuCoin', res);
          return;
        }

        const { token, instanceServers } = res.data;
        // Tomamos el primer server (normalmente hay uno o dos)
        const endpoint = instanceServers[0].endpoint;
        // Construimos la URL con el token
        const wsUrl = `${endpoint}?token=${token}&connectId=${Date.now()}`;

        // Creamos el socket
        this.sockets['KuCoin_spot'] = webSocket({
          url: wsUrl,
          openObserver: {
            next: () => {
              console.log('KuCoin spot WebSocket conectado');
              // Mandamos la suscripción
              const subscriptionMsg = {
                id: Date.now(),
                type: 'subscribe',
                topic: '/market/ticker:BTC-USDT',
                privateChannel: false,
                response: true
              };
              this.sockets['KuCoin_spot'].next(subscriptionMsg);

              // Lanzamos ping periódico cada ~25s
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
              console.warn('KuCoin_spot websocket cerrado');
            }
          }
        });

        // Suscribimos para recibir mensajes
        this.sockets['KuCoin_spot'].subscribe({
          next: msg => this.handleSpotPrice('KuCoin', msg),
          error: err => console.error('KuCoin_spot error:', err)
        });
      }, err => {
        console.error('Error al obtener bullet-public de KuCoin:', err);
      });
  }

  // Observables para que tus componentes se suscriban
  getSpotPrice(exchange: string): Observable<any> {
    return this.spotPriceSubjects[exchange]?.asObservable() || new Observable();
  }
  getFuturesPrice(exchange: string): Observable<any> {
    return this.futuresPriceSubjects[exchange]?.asObservable() || new Observable();
  }

  /**
   * Mensaje de suscripción SPOT según el exchange
   */
  private getSpotSubscriptionMessage(exchange: string): any {
    switch (exchange) {
      case 'Binance':
        // Binance ya está conectado a btcusdt@trade (no requiere msg)
        return null;
      case 'Bybit':
        return {
          op: 'subscribe',
          args: [{ channel: 'tickers', instType: 'SPOT', instId: 'BTCUSDT' }]
        };
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
            { channel: 'tickers', instId: 'BTC-USDT' }
          ]
        };
      case 'Huobi':
        return {
          sub: 'market.BTCUSDT.trade.detail',
          id: 'myUniqueId'
        };
      case 'Gate.io':
        return {
          time: Date.now(),
          channel: 'spot.tickers',
          event: 'subscribe',
          payload: ['BTC_USDT']
        };
      // KuCoin se maneja en connectKuCoinSpot()
      default:
        return null;
    }
  }

  /**
   * Procesa el mensaje SPOT para extraer el último precio
   */
  private handleSpotPrice(exchange: string, msg: any) {
    let price = 0;
    switch (exchange) {
      case 'Binance':
        // { p: "12345.67", ... }
        if (msg?.p) price = parseFloat(msg.p);
        break;
      case 'Bybit':
        // { topic: 'tickers', data: { price: "12345.67" } }
        if (msg?.topic === 'tickers' && msg?.data?.price) {
          price = parseFloat(msg.data.price);
        }
        break;
      case 'Kraken':
        // [channelId, {c:["12345.6","1","1.000"]}, "ticker", "XBT/USD"]
        if (Array.isArray(msg) && msg[1]?.c) {
          price = parseFloat(msg[1].c[0]);
        }
        break;
      case 'Coinbase':
        // { type: 'ticker', price: '12345.67', product_id: 'BTC-USD' }
        if (msg?.type === 'ticker' && msg?.price) {
          price = parseFloat(msg.price);
        }
        break;
      case 'Bitfinex':
        // [chanId, [BID, BID_SIZE, ASK, ASK_SIZE, DAILY_CHANGE, DAILY_CHANGE_REL, LAST_PRICE, VOL, HIGH, LOW]]
        if (Array.isArray(msg) && Array.isArray(msg[1])) {
          const lastPrice = msg[1][6];
          if (lastPrice) {
            price = parseFloat(lastPrice);
          }
        }
        break;
      case 'OKX':
        // { arg: { channel:'tickers', instId:'BTC-USDT' }, data: [{ last:'12345.67' }] }
        if (msg?.arg?.channel === 'tickers' && msg?.data?.[0]?.last) {
          price = parseFloat(msg.data[0].last);
        }
        break;
      case 'Huobi':
        // { ch: 'market.BTCUSDT.trade.detail', tick: { data: [ { price: 12345.67 } ] } }
        if (msg?.ch?.includes('BTCUSDT') && msg?.tick?.data?.length) {
          price = parseFloat(msg.tick.data[0].price);
        }
        break;
      case 'KuCoin':
        // {type:"message", topic:"/market/ticker:BTC-USDT", data:{ price:"12345.67", ...}}
        if (msg?.topic?.includes('ticker:BTC-USDT') && msg?.data?.price) {
          price = parseFloat(msg.data.price);
        }
        break;
      case 'Gate.io':
        // { channel:'spot.tickers', event:'update', result:[ { last:'12345.67', ... } ] }
        if (msg?.channel === 'spot.tickers' &&
          msg?.event === 'update' &&
          Array.isArray(msg.result) &&
          msg.result[0]?.last) {
          price = parseFloat(msg.result[0].last);
        }
        break;
    }
    this.spotPriceSubjects[exchange].next({ price });
  }

  /**
   * Procesa el mensaje de Futuros
   */
  private handleFuturesPrice(exchange: string, msg: any) {
    let price = 0;
    switch (exchange) {
      case 'Binance':
        if (msg?.p) {
          price = parseFloat(msg.p);
        }
        break;
      // etc...
    }
    this.futuresPriceSubjects[exchange].next({ price });
  }
}
