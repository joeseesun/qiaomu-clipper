class QiaomuAudioCapture extends AudioWorkletProcessor {
	constructor() {
		super();
		this.buffer = new Float32Array(2048);
		this.offset = 0;
	}
	process(inputs) {
		const channels = inputs[0];
		if (!channels?.length) return true;
		for (let index = 0; index < channels[0].length; index++) {
			let value = 0;
			for (const channel of channels) value += channel[index];
			this.buffer[this.offset++] = value / channels.length;
			if (this.offset === this.buffer.length) {
				this.port.postMessage(this.buffer, [this.buffer.buffer]);
				this.buffer = new Float32Array(2048);
				this.offset = 0;
			}
		}
		return true;
	}
}
registerProcessor('qiaomu-audio-capture', QiaomuAudioCapture);
