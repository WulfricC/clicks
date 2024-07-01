import { DataChunk } from "./riff.js";

export const PCM_INTERNAL_RATE = 48000;
export const TIME_RESOLUTION = 1000000;

class PcmTransformerInterface {
    static async fromFmtChunk(fmtChunk) {
        const audioFormat = await fmtChunk.getAudioFormat();
        if (audioFormat != 1)
            throw new Error(`selected format is not PCM`);
        return new this(
            await fmtChunk.getNumChannels(),
            await fmtChunk.getBitsPerSample(),
            await fmtChunk.getSampleRate(),
        );
    }
    constructor (channelCount, bitDepth, sampleRate) {
        this.channelCount = channelCount;
        this.bitDepth = bitDepth;
        this.sampleRate = sampleRate;
        this.sampleStride = channelCount * bitDepth;
    }
}

export class PcmDecoder extends PcmTransformerInterface {

    static bufferToFloats = {
        [8]: buffer => [...new Uint8Array(buffer)].map(v=> (v-127) / 128),
        [16]: buffer => [...new Int16Array(buffer)].map(v=> v/(1<<16)),
        [24]: buffer => {
            const bytes = new Uint8Array(buffer);
            return new Array(buffer.byteLength/3).fill(0).map((v,i) => {
                const val = (bytes[i*3] | bytes[i*3+1] << 8 | bytes[i*3+2] << 16);
                if (!(val & 0x800000)) 
                    return val/(1<<23);
                else
                    return ((0xffffff - val + 1) * -1)/(1<<23);
            })
        },
        [32]: buffer => [...new Int32Array(buffer)].map(v=>v/(1<<31))
    }

    decode() {
        const channelCount = this.channelCount;
        const sampleRate = this.sampleRate;
        const bitDepth = this.bitDepth;
        const bufferToFloats = this.constructor.bufferToFloats[bitDepth];
        const sampleStride = channelCount * (bitDepth/8);

        let chunkTransfer;

        // do a rate difference by duplicating or removing values
        const rateDifference = PCM_INTERNAL_RATE/sampleRate
        let aCount = 0;
        let bCount = 0;
        
        if (bufferToFloats === undefined)
            throw new Error(`a sample bit depth of ${bitDepth} is not supported`);

        function transform(chunk, controller) {
            if (!(chunk instanceof DataChunk)) return;

            // get whole number of samples from buffer
            const completeDataBuffer = concatBuffers(chunk.buffer, chunkTransfer);
            const sampleCount = Math.floor(completeDataBuffer.byteLength / sampleStride);
            const readBuffer = completeDataBuffer.slice(0, sampleCount * sampleStride);
            chunkTransfer = completeDataBuffer.slice(sampleCount * sampleStride);

            // transform samples to floats
            const floats = bufferToFloats(readBuffer);

            // divide out channels
            const channels = new Array(sampleCount).fill(0).map((v,i) => floats.slice(i*channelCount, (i+1)*channelCount));

            // go through channels one by one and duplicate or remove samples to change sample rate
            for(let i = 0; i < channels.length; i++) {
                while (aCount*rateDifference - bCount > 1) {
                    channels.splice(i,0,channels[i]);
                    bCount ++;
                    i ++;
                }
                while (aCount*rateDifference - bCount < -1) {
                    channels.splice(i,1);
                    i--
                    bCount --;
                }
                aCount ++
                bCount ++
            }

            // calculate metadata about chunk
            const start = Math.floor((chunk.position-chunkTransfer?.byteLength??0) / ((sampleStride * sampleRate)/TIME_RESOLUTION));
            controller.enqueue(new PcmAudioSnippet(start, new PcmAudioSample(channels)));
        }

        return new TransformStream({transform});
    }
}

export let maxFloat = 0;
export class PcmEncoder extends PcmTransformerInterface {
    static floatsToBuffer = {
        [8]: floats => new Uint8Array(floats.map(f => f*128+127)).buffer,
        [16]: floats => new Int16Array(floats.map(f => f*(1<<15))).buffer,
        [24]: floats => {
            const bytes = new Int8Array(floats.length*3);
            floats.map((v,i) => {
                const int = v >= 0 ? v*(1<<23) : 0xffffff + v*(1<<23) + 1;
                bytes[i*3] = int & 0xFF;
                bytes[i*3+1] = (int >>> 8) & 0xFF;
                bytes[i*3+2] = (int >>> 16) & 0xFF;
            })
            return bytes;
        },
        [32]: floats => new Int32Array(floats.map(v => v*(1<<31))).buffer
    }
    encode() {
        const channelCount = this.channelCount;
        const bitDepth = this.bitDepth;
        const sampleRate = this.sampleRate;
        const floatsToBuffer = this.constructor.floatsToBuffer[bitDepth];
        const sampleStride = channelCount * (bitDepth/8);
        
        if (floatsToBuffer === undefined)
            throw new Error(`a sample bit depth of ${bitDepth} is not supported`);

        const rateDifference = sampleRate/PCM_INTERNAL_RATE
        let aCount = 0;
        let bCount = 0;

        function transform(chunk, controller) {
            //if (!(chunk instanceof PcmAudioChunk)) return;
            // convert to correct number of channels
            const channels = chunk.sample.map(a => {
                if (a.length > channelCount) 
                    return a.slice(0,channelCount);
                else if (a.length < channelCount)
                    return a.concat(new Array(channelCount - a.length).fill(0));
                else
                    return a;
            });
            // go through channels one by one and duplicate or remove samples to change sample rate
            for(let i = 0; i < channels.length; i++) {
                while (aCount*rateDifference - bCount > 1) {
                    channels.splice(i,0,channels[i]);
                    bCount ++;
                    i ++;
                }
                while (aCount*rateDifference - bCount < -1) {
                    channels.splice(i,1);
                    i--;
                    bCount --;
                }
                aCount ++
                bCount ++
            }

            const position = Math.floor(chunk.start * sampleRate/TIME_RESOLUTION) * sampleStride;
            const floatSamples = channels.flat();
            const buffer = floatsToBuffer(floatSamples);
            controller.enqueue(new DataChunk(position, buffer));
        }

        return new TransformStream({transform});
    }
}

// holds a short snippet of PCM audio, cannot be written directly as it has no position
export class PcmAudioSample extends Array{
    constructor (samples) {
        super();
        if(typeof samples[Symbol.iterator] === "function")
            this.push(...samples)
    }
    static fromSamples(samples) {
        return new this(samples);
    }
    static fromChannels(channels) {
        const samples = new Array(channels[0].length).fill(0).map((v,i) => channels.map(c => c[i]));
        return new this(samples);
    }
    get duration () {
        return this.length / (PCM_INTERNAL_RATE/TIME_RESOLUTION);
    }
    *channel(n) {
        for(const sample of this)
            yield sample[n]
    }
    get channelCount () {
        return this[0].length;
    }
    *channels() {
        for(let c = 0; c < this.channelCount; c ++)
            yield this.channel(c);
    }
}

// holds a chunk of PCM audio stream whi
export class PcmAudioSnippet{
    constructor (start, sample) {
        this.start = start;
        this.sample = sample;
    }
}

function concatBuffers(...buffers) {
    const cleanBuffs = buffers.filter(v => v instanceof ArrayBuffer);
    const size = cleanBuffs.reduce((s,v) => s + v.byteLength, 0);
    const dump = new Uint8Array(size);
    let position = 0;
    for (const buffer of cleanBuffs) {
        dump.set(new Uint8Array(buffer), position);
        position += buffer.byteLength;
    }
    return dump.buffer;
}