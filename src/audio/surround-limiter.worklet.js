/* Shared detector and gain for all six speakers: direction survives limiting. */
class SurroundLimiter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.envelope = 0;
    this.reduced = false;
    this.port.onmessage = e => { this.reduced = e.data === 'reduced'; };
  }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    if (!output.length) return true;
    const release = Math.exp(-1 / (sampleRate * 0.12));
    for (let i = 0; i < output[0].length; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++) peak = Math.max(peak, Math.abs(input[c][i] || 0));
      this.envelope = Math.max(peak, this.envelope * release);
      const threshold = this.reduced ? 0.24 : 0.5;
      const compression = this.envelope > threshold ? Math.pow(threshold / this.envelope, this.reduced ? 0.75 : 0.4) : 1;
      const gain = Math.min(0.72 * compression, peak > 0 ? 0.96 / peak : 1);
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c]?.[i] || 0) * gain;
    }
    return true;
  }
}
registerProcessor('vanguard-surround-limiter', SurroundLimiter);
