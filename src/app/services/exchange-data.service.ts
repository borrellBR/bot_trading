import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
// pako se usa solo si necesitas descomprimir algo; de momento no se está usando.
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

  /**
   * Inicializa conexiones solo si es navegador y no se ha inicializado ya
   */
  initialize() {
    if (this.isInitialized) return;
    if (isPlatformBrowser(this.platformId)) {
      this.connectToExchanges();
      this.isInitialized = true;
    }
  }

  /**
   * Crea los websockets (Spot/Futuros) para cada exchange
   */
  private connectToExchanges() {
    // Aquí defines la info de SPOT y FUTUROS (url, symbol, fecha, etc.)
    // Ajusta futuresUrl / futuresSymbol según cada exchange.
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
        name: 'KuCoin',
        // Mantenemos spotUrl = null para forzar uso de "connectKuCoinSpot()"
        spotUrl: null,
        // Si quieres Futuros KuCoin, podrías ponerlo aquí:
        // futuresUrl: 'wss://ws-api-futures.kucoin.com',
        // futuresSymbol: 'XBTUSDTM_250627',
        expirationDate: '2025-06-27'
      }
    ];

    // Creamos BehaviorSubjects para SPOT y FUTURES
    exchanges.forEach(exchange => {
      this.spotPriceSubjects[exchange.name] = new BehaviorSubject<any>({
        price: 0,
        expirationDate: exchange.expirationDate
      });
      this.futuresPriceSubjects[exchange.name] = new BehaviorSubject<any>({
        price: 0,
        expirationDate: exchange.expirationDate
      });

      // SPOT normal
      if (exchange.spotUrl && exchange.name !== 'KuCoin') {
        this.createSpotWebSocket(exchange.name, exchange.spotUrl);
      }

      // FUTURES normal
      if (exchange.futuresUrl && exchange.futuresSymbol && exchange.name !== 'KuCoin') {
        this.createFuturesWebSocket(exchange.name, exchange.futuresUrl, exchange.futuresSymbol);
      }

      // *** Mantener KuCoin Spot EXACTO como tu snippet original (para no romperlo) ***
      if (exchange.name === 'KuCoin') {
        this.connectKuCoinSpot(); // Sin tocar

        // Si quisieras Futuros KuCoin, descomenta y define futuresUrl + futuresSymbol arriba.
        // if (exchange.futuresUrl && exchange.futuresSymbol) {
        //   this.connectKuCoinFutures(exchange.futuresUrl, exchange.futuresSymbol);
        // }
      }
    });
  }

  // -----------------------------------------------------------------------
  // SPOT normal
  // -----------------------------------------------------------------------
  private createSpotWebSocket(exchangeName: string, url: string) {
    this.sockets[`${exchangeName}_spot`] = webSocket({
      url,
      openObserver: {
        next: () => {
          console.log(`${exchangeName} spot WebSocket conectado`);
          const subMsg = this.getSpotSubscriptionMessage(exchangeName);
          if (subMsg) {
            console.log(`[${exchangeName} SPOT] -> Enviando subscripción`, subMsg);
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

  // -----------------------------------------------------------------------
  // FUTURES normal
  // -----------------------------------------------------------------------
  private createFuturesWebSocket(exchangeName: string, url: string, futuresSymbol: string) {
    this.sockets[`${exchangeName}_futures`] = webSocket({
      url,
      openObserver: {
        next: () => {
          console.log(`${exchangeName} futures WebSocket conectado`);
          // Aquí mandas el mensaje de suscripción, si es necesario
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

  // -----------------------------------------------------------------------
  // *** KuCoin Spot EXACTO del snippet original (no se toca) ***
  // -----------------------------------------------------------------------
  private connectKuCoinSpot() {
    // Llamada HTTP a tu endpoint "bullet-public"
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

              // Ping cada 25s
              setInterval(() => {
                this.sockets['KuCoin_spot'].next({
                  id: Date.now(),
                  type: 'ping'
                });
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

  /**
   * (Opcional) Si quisieras KuCoin Futuros, análogamente:
   */
  /*
  private connectKuCoinFutures(url: string, futuresSymbol: string) {
    this.http.post('https://api-futures.kucoin.com/api/v1/bullet-public', {})
      .subscribe((res: any) => {
        if (!res?.data?.instanceServers?.length) {
          console.error('No se obtuvieron instanceServers de KuCoin Futures', res);
          return;
        }
        const { token, instanceServers } = res.data;
        const endpoint = instanceServers[0].endpoint;
        const wsUrl = `${endpoint}?token=${token}&connectId=${Date.now()}`;

        this.sockets['KuCoin_futures'] = webSocket({
          url: wsUrl,
          openObserver: {
            next: () => {
              console.log('KuCoin futures WebSocket conectado');
              const subMsg = {
                id: Date.now(),
                type: 'subscribe',
                topic: `/contractMarket/ticker:${futuresSymbol}`,
                privateChannel: false,
                response: true
              };
              this.sockets['KuCoin_futures'].next(subMsg);

              setInterval(() => {
                this.sockets['KuCoin_futures'].next({
                  id: Date.now(),
                  type: 'ping'
                });
              }, 25000);
            }
          },
          closeObserver: {
            next: () => console.warn('KuCoin_futures websocket cerrado')
          }
        });

        this.sockets['KuCoin_futures'].subscribe({
          next: msg => this.handleFuturesPrice('KuCoin', msg),
          error: err => console.error('KuCoin_futures error:', err)
        });
      }, err => console.error('Error al obtener bullet-public de KuCoin Futures:', err));
  }
  */

  // --------------------------------------------------
  // Observables para que el componente se suscriba
  // --------------------------------------------------
  getSpotPrice(exchange: string): Observable<any> {
    return this.spotPriceSubjects[exchange]?.asObservable() || new Observable();
  }

  getFuturesPrice(exchange: string): Observable<any> {
    return this.futuresPriceSubjects[exchange]?.asObservable() || new Observable();
  }

  // --------------------------------------------------
  // Mensajes de suscripción SPOT
  // --------------------------------------------------
  private getSpotSubscriptionMessage(exchange: string): any {
    switch (exchange) {
      case 'Binance':
        // No se envía nada, ya suscrito con "btcusdt@trade"
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
      // KuCoin => se gestiona con connectKuCoinSpot() sin tocar nada
      default:
        return null;
    }
  }

  // --------------------------------------------------
  // Mensajes de suscripción FUTURES
  // --------------------------------------------------
  private getFuturesSubscriptionMessage(exchange: string, futuresSymbol: string): any {
    // Ajusta según la API de cada exchange
    switch (exchange) {
      case 'Binance':
        // Si quieres mandar un SUBSCRIBE extra, hazlo. Normalmente con @markPrice en la URL ya funciona.
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

  // --------------------------------------------------
  // Procesar precio de SPOT
  // --------------------------------------------------
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
        // [chanId, [ ..., LAST_PRICE, ... ]]
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
        // Manteniendo exactamente tu lógica original
        if (msg?.topic?.includes('ticker:BTC-USDT') && msg?.data?.price) {
          price = parseFloat(msg.data.price);
        }
        break;
    }

    this.spotPriceSubjects[exchange].next({ price });
  }

  // --------------------------------------------------
  // Procesar precio de FUTURES
  // --------------------------------------------------
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
        // [channelId, { c:["12345.6","1","1.000"] }, "ticker", "PI_XBTUSD_250627"]
        if (Array.isArray(msg) && msg[1]?.c) {
          price = parseFloat(msg[1].c[0]);
        }
        break;
      case 'Bitfinex':
        // [chanId, [ ..., LAST_PRICE, ... ]]
        if (Array.isArray(msg) && Array.isArray(msg[1])) {
          const lastPrice = msg[1][6];
          if (lastPrice) {
            price = parseFloat(lastPrice);
          }
        }
        break;
      case 'OKX':
        // { arg:{ channel:'mark-price', instId:'BTC-USDT-250627'}, data:[{ markPx:'12345.67' }] }
        if (msg?.arg?.channel === 'mark-price' && msg?.data?.[0]?.markPx) {
          price = parseFloat(msg.data[0].markPx);
        }
        break;
      case 'KuCoin':
        // Si en algún momento activas Futuros KuCoin, parsea aquí:
        // if (msg?.topic?.includes(`ticker:XBTUSDTM_250627`) && msg?.data?.price) {...}
        break;
    }

    this.futuresPriceSubjects[exchange].next({ price });
  }
}
