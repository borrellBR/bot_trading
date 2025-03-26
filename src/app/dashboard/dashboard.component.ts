import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExchangeDataService } from '../services/exchange-data.service';
import { ExchangeData } from '../models/exchange-data';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  exchangeData: ExchangeData[] = [];
  collateralOptions = [100, 50, 30];
  interestRate = 0.05; // 5% anual para el cálculo de rentabilidad

  constructor(private exchangeDataService: ExchangeDataService) { }

  ngOnInit() {
    // Inicia las conexiones WebSocket
    this.exchangeDataService.initialize();

    // Los 6 exchanges que usaremos (con o sin futuros)
    const exchanges = ['Binance', 'Kraken', 'Coinbase', 'Bitfinex', 'OKX', 'KuCoin'];

    // Creamos objetos de datos para cada exchange
    exchanges.forEach(exchange => {
      this.exchangeData.push({
        name: exchange,
        spotBtcUsdt: 0,
        spotBtcUsdc: 0,        // (placeholder, si hicieras USDC)
        futuresBtcUsdt: 0,
        futuresBtcUsdc: 0,     // (placeholder)
        // Fecha de vencimiento para el cálculo
        expirationDateBtcUsdt: '2025-06-27',
        expirationDateBtcUsdc: '2025-06-28'
      });

      // Suscribimos SPOT
      this.exchangeDataService.getSpotPrice(exchange).subscribe((msg: any) => {
        this.updateSpotPrice(exchange, msg);
      });

      // Suscribimos FUTURES
      this.exchangeDataService.getFuturesPrice(exchange).subscribe((msg: any) => {
        this.updateFuturesPrice(exchange, msg);
      });
    });
  }

  updateSpotPrice(exchange: string, msg: any) {
    const data = this.exchangeData.find(e => e.name === exchange);
    if (data) {
      data.spotBtcUsdt = msg.price || 0;
    }
  }

  updateFuturesPrice(exchange: string, msg: any) {
    const data = this.exchangeData.find(e => e.name === exchange);
    if (data) {
      data.futuresBtcUsdt = msg.price || 0;
    }
  }

  /**
   * Cálculo de la rentabilidad:
   * ( (Futuros - Spot) - (1 - c)*Spot*r*T ) / (c*Spot)
   * donde:
   *   c = collateralPercent/100
   *   r = tasa anual (this.interestRate)
   *   T = fracción de año hasta la fecha de expiración
   */
  calculateProfitability(
    spotPrice: number,
    futuresPrice: number,
    collateralPercent: number,
    expirationDate: string
  ): number {
    if (spotPrice === 0 || futuresPrice === 0) return 0;

    const currentDate = new Date();
    const expDate = new Date(expirationDate);
    const T = (expDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
    const r = this.interestRate; // 5% anual
    const c = collateralPercent / 100;

    // Ganancia bruta: (Futuros - Spot)
    // Costo de financiamiento: (1 - c)*Spot*r*T
    const profit = futuresPrice - spotPrice - (1 - c) * spotPrice * r * T;
    const initialInvestment = c * spotPrice; // capital invertido (colateral)

    return (profit / initialInvestment) * 100;
  }
}
