// EWMA volatility of the fused mid, in log-return per √second.
export class Volatility {
  private variance = 0;
  private samples = 0;
  private last: { mid: number; ts: number } | null = null;

  constructor(
    private readonly halfLifeSec = 60,
    private readonly floor = 0.0002,
    private readonly warmupSamples = 60,
  ) {}

  update(mid: number, ts: number): void {
    const previous = this.last;
    if (previous && ts - previous.ts < 1000) return;
    this.last = { mid, ts };
    if (!previous) return;
    const seconds = (ts - previous.ts) / 1000;
    const logReturn = Math.log(mid / previous.mid);
    const alpha = 1 - 0.5 ** (seconds / this.halfLifeSec);
    this.variance = (1 - alpha) * this.variance + (alpha * logReturn * logReturn) / seconds;
    this.samples += 1;
  }

  get sigma1(): number {
    if (this.samples < this.warmupSamples) return Math.max(this.floor, Math.sqrt(this.variance));
    return Math.max(Math.sqrt(this.variance), this.floor / 4);
  }
}
