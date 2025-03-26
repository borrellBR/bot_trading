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
  interestRate = 0.05;

  constructor(private exchangeDataService: ExchangeDataService) { }

  ngOnInit() {
    this.exchangeDataService.initialize();
    const exchanges = ['Binance', 'Kraken', 'Coinbase', 'Bitfinex', 'OKX', 'KuCoin'];
    exchanges.forEach(exchange => {
      this.exchangeData.push({
        name: exchange,
        spotBtcUsdt: 0,
        spotBtcUsdc: 0,
        futuresBtcUsdt: 0,
        futuresBtcUsdc: 0,
        expirationDateBtcUsdt: '2025-06-30',
        expirationDateBtcUsdc: '2025-06-30'
      });

      this.exchangeDataService.getSpotPrice(exchange).subscribe((msg: any) => {
        this.updateSpotPrice(exchange, msg);
      });

      this.exchangeDataService.getFuturesPrice(exchange).subscribe((msg: any) => {
        this.updateFuturesPrice(exchange, msg);
      });
    });
  }

  updateSpotPrice(exchange: string, msg: any) {
    const data = this.exchangeData.find(e => e.name === exchange);
    if (data) data.spotBtcUsdt = msg.price || 0;
  }

  updateFuturesPrice(exchange: string, msg: any) {
    const data = this.exchangeData.find(e => e.name === exchange);
    if (data) data.futuresBtcUsdt = msg.price || 0;
  }

  calculateProfitability(spotPrice: number, futuresPrice: number, collateralPercent: number, expirationDate: string): number {
    if (spotPrice === 0 || futuresPrice === 0) return 0;
    const currentDate = new Date();
    const expDate = new Date(expirationDate);
    const T = (expDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
    const r = this.interestRate;
    const c = collateralPercent / 100;
    const profit = futuresPrice - spotPrice - (1 - c) * spotPrice * r * T;
    const initialInvestment = c * spotPrice;
    return (profit / initialInvestment) * 100;
  }
}
