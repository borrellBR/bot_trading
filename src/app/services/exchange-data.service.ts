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
  private futuresSymbols: { [key: string]: string } = {};
  private expirationDates: { [key: string]: string } = {};

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private http: HttpClient
  ) { }

  initialize() {
    if (this.isInitialized) return;
    if (isPlatformBrowser(this.platformId)) {
      this.setupFuturesContracts();
      this.connectToExchanges();
      this.isInitialized = true;
    }
  }

  setupFuturesContracts() {
    const exchanges = [
      { name: 'Binance', spotUrl: 'wss://stream.binance.com:9443/ws/btcusdt@trade', futuresBaseUrl: 'wss://fstream.binance.com/ws/' },
      { name: 'Bybit', spotUrl: 'wss://stream.bybit.com/v5/public/spot', futuresBaseUrl: 'wss://stream.bybit.com/v5/public/linear' },
      { name: 'Kraken', spotUrl: 'wss://ws.kraken.com', futuresBaseUrl: 'wss://futures.kraken.com/websockets/v1/public' },
      { name: 'Coinbase', spotUrl: 'wss://ws-feed.exchange.coinbase.com', futuresBaseUrl: null },
      { name: 'Bitfinex', spotUrl: 'wss://api-pub.bitfinex.com/ws/2', futuresBaseUrl: 'wss://api-pub.bitfinex.com/ws/2' },
      { name: 'OKX', spotUrl: 'wss://ws.okx.com:8443/ws/v5/public', futuresBaseUrl: 'wss://ws.okx.com:8443/ws/v5/public' },
      { name: 'Huobi', spotUrl: 'wss://api.huobi.pro/ws', futuresBaseUrl: 'wss://api.hbdm.com/linear-swap-ws' },
      { name: 'KuCoin', spotUrl: 'wss://ws-api-spot.kucoin.com', futuresBaseUrl: 'wss://ws-api-futures.kucoin.com' },
      { name: 'Gate.io', spotUrl: 'wss://ws.gate.io/v4/ws/usdt', futuresBaseUrl: 'wss://fx-ws.gate.io/v4/ws/usdt' },
      { name: 'Deribit', spotUrl: null, futuresBaseUrl: 'wss://www.deribit.com/ws/api/v2' }
    ];
    exchanges.forEach(exchange => {
      if (exchange.name === 'Binance') {
        this.futuresSymbols['Binance'] = 'BTCUSDT_250627';
        this.expirationDates['Binance'] = '2025-06-27';
      }
    });
  }

  connectToExchanges() {
    const exchanges = [
      { name: 'Binance', spotUrl: 'wss://stream.binance.com:9443/ws/btcusdt@trade', futuresUrl: `wss://fstream.binance.com/ws/${this.futuresSymbols['Binance']}@markPrice` },
      { name: 'Bybit', spotUrl: 'wss://stream.bybit.com/v5/public/spot', futuresUrl: 'wss://stream.bybit.com/v5/public/linear' },
      { name: 'Kraken', spotUrl: 'wss://ws.kraken.com', futuresUrl: 'wss://futures.kraken.com/websockets/v1/public' },
      { name: 'Coinbase', spotUrl: 'wss://ws-feed.exchange.coinbase.com', futuresUrl: null },
      { name: 'Bitfinex', spotUrl: 'wss://api-pub.bitfinex.com/ws/2', futuresUrl: 'wss://api-pub.bitfinex.com/ws/2' },
      { name: 'OKX', spotUrl: 'wss://ws.okx.com:8443/ws/v5/public', futuresUrl: 'wss://ws.okx.com:8443/ws/v5/public' },
      { name: 'Huobi', spotUrl: 'wss://api.huobi.pro/ws', futuresUrl: 'wss://api.hbdm.com/linear-swap-ws' },
      { name: 'KuCoin', spotUrl: 'wss://ws-api-spot.kucoin.com', futuresUrl: 'wss://ws-api-futures.kucoin.com' },
      { name: 'Gate.io', spotUrl: 'wss://ws.gate.io/v4/ws/usdt', futuresUrl: 'wss://fx-ws.gate.io/v4/ws/usdt' },
      { name: 'Deribit', spotUrl: null, futuresUrl: 'wss://www.deribit.com/ws/api/v2' }
    ];

    exchanges.forEach(exchange => {
      this.spotPriceSubjects[exchange.name] = new BehaviorSubject<any>({ price: 0 });
      this.futuresPriceSubjects[exchange.name] = new BehaviorSubject<any>({ price: 0 });

      if (exchange.spotUrl) {
        this.sockets[`${exchange.name}_spot`] = webSocket(exchange.spotUrl);
        this.sockets[`${exchange.name}_spot`].subscribe({
          next: msg => this.handleSpotPrice(exchange.name, msg),
          error: err => console.error(`${exchange.name}_spot error:`, err)
        });
      }
      if (exchange.futuresUrl) {
        this.sockets[`${exchange.name}_futures`] = webSocket(exchange.futuresUrl);
        this.sockets[`${exchange.name}_futures`].subscribe({
          next: msg => this.handleFuturesPrice(exchange.name, msg),
          error: err => console.error(`${exchange.name}_futures error:`, err)
        });
      }
    });
  }

  getSpotPrice(exchange: string): Observable<any> {
    return this.spotPriceSubjects[exchange]?.asObservable() || new Observable();
  }

  getFuturesPrice(exchange: string): Observable<any> {
    return this.futuresPriceSubjects[exchange]?.asObservable() || new Observable();
  }

  private handleSpotPrice(exchange: string, msg: any) {
    console.log(`${exchange} Spot:`, msg);
    let price = 0;
    if (exchange === 'Binance' && msg.p) price = parseFloat(msg.p);
    this.spotPriceSubjects[exchange].next({ price });
  }

  private handleFuturesPrice(exchange: string, msg: any) {
    console.log(`${exchange} Futures:`, msg);
    let price = 0;
    if (exchange === 'Binance' && msg.p) price = parseFloat(msg.p);
    this.futuresPriceSubjects[exchange].next({ price });
  }
}
