/**
 * Library for reading and writing PCM WAV files.
 */

import {Block, Riff, DataBlock} from "./riff.js";
import { PcmDecoder, PcmEncoder } from "./pcm.js";

export class Wav extends Riff {
    static async readStreamFile(path, chunkSize) {
        const file = await Deno.open(path, {read: true});
        const wav = new this(file, 0);
        if (await wav.getType() !== "WAVE")
            throw new Error(`riff file is not valid WAV`);
        return await wav.readStream(chunkSize);
    }
    static async writeStreamFile(path, properties) {
        const settings = {
            numChannels: 1,
            sampleRate: 48000,
            sampleBitDepth: 32
        };
        Object.assign(settings, properties);
        const file = await Deno.open(path, {create:true, write: true, read: true});
        const wav = new this(file, 0);
        return wav.writeStream(settings);
    }
    async readStream(chunkSize = 1024) {
        // read the chunks from the file
        this.fmt = undefined;
        this.data = undefined;
        for await (const {tag, position} of this.chunks()) {
            if (tag === "fmt ")
                this.fmt = new WavFmtChunk(this.file, position);
            else if (tag === "data")
                this.data = new DataBlock(this.file, position);
        }
        // create a reading stream using read data
        const sampleStride = await this.fmt.getBlockAlign();
        const decoder = await PcmDecoder.fromFmtChunk(this.fmt);
        return this.data.readStream(chunkSize * sampleStride).pipeThrough(decoder.decode());
    }
    async write(settings, data) {
        let p = 0;
        p = await super.write("WAVE");
        this.fmt = new WavFmtChunk(this.file, p);
        p = await this.fmt.write(settings);
        this.data = new DataBlock(this.file, p);
        p = await this.data.write(data);
        return p;
    }
    async writeStream(settings) {
        if (!this.fmt || !this.chunks)
            await this.write(settings);

        const onComplete = async () => {
            const size = 12
                + await this.fmt.getSize() + 8 
                + await this.data.getSize() + 8
            await this.setSize(size);
        }
        
        const encoder = await PcmEncoder.fromFmtChunk(this.fmt);
        const encoderStream = encoder.encode();
        encoderStream.readable.pipeTo(this.data.writeStream(onComplete));
        return encoderStream.writable;
    }
}

export class WavFmtChunk extends Block {
    constructor (file, position) {
        super(file, position);
        this.getAudioFormat = () => this.getNumber(8, "uInt16");
        this.getNumChannels = () => this.getNumber(10, "uInt16");
        this.getSampleRate = () => this.getNumber(12, "uInt32");
        this.getByteRate = () => this.getNumber(16, "uInt32");
        this.getBlockAlign = () => this.getNumber(20, "uInt16");
        this.getBitsPerSample = () => this.getNumber(22, "uInt16");
    }
    async write(settings) {
        const inputVals = {
            numChannels: 1,
            sampleRate: 48000,
            sampleBitDepth: 32
        };
        Object.assign(inputVals, settings);

        await this.setStr(0, 4, "fmt ");
        await this.setNumber(4, "uInt32", 16);
        await this.setNumber(8, "uInt16", 1);
        await this.setNumber(10, "uInt16", inputVals.numChannels);
        await this.setNumber(12, "uInt32", inputVals.sampleRate);
        await this.getNumber(16, "uInt32", inputVals.sampleRate * inputVals.numChannels * inputVals.sampleBitDepth/8);
        await this.setNumber(20, "uInt16", inputVals.numChannels * inputVals.sampleBitDepth/8);
        await this.setNumber(22, "uInt16", inputVals.sampleBitDepth);

        return this.position + 24;
    }
}