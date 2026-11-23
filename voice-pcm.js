// The AudioContext resamples the microphone to 16 kHz before this worklet.
class VoicePcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(1600);
    this.count = 0;
    this.active = true;
    this.port.onmessage = ({data}) => {
      this.flush();
      this.active = data === 'resume';
      this.port.postMessage(data);
    };
  }
  flush() {
    if (!this.count) return;
    const frame = this.buffer.slice(0, this.count);
    this.port.postMessage(frame.buffer, [frame.buffer]);
    this.count = 0;
  }
  process(inputs) {
    if (this.active) for (const value of inputs[0]?.[0] || []) {
      this.buffer[this.count++] = Math.max(-32768, Math.min(32767, Math.round(value * 32768)));
      if (this.count === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor('voice-pcm', VoicePcm);
