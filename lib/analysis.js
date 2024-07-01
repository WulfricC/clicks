/**
 * Stream based data processing.
 * Library by the Author.
 */

import { PcmAudioSnippet, PcmAudioSample, PCM_INTERNAL_RATE, TIME_RESOLUTION } from "./pcm.js";
import { map } from "./processing-streams.js";
import { FFT } from "./fft.js";

// resize chunks into fixed sizes
export function resizeSnippets(sampleCount) {
    const sampleBuffer = [];
    let samplesRead = 0;
    let firstStart;
    async function transform(chunk, controller) {
        if (firstStart == undefined) {
            firstStart = chunk.start;
        }
        // append sample chunks into sampleBuffer
        sampleBuffer.splice(sampleBuffer.length, 0, ...chunk.sample);
        // read out chunks from sampleBuffer
        while(sampleBuffer.length > sampleCount) {
            const channelSlice = sampleBuffer.splice(0, sampleCount);
            const sample = new PcmAudioSample(channelSlice)
            const start = Math.floor(samplesRead / (PCM_INTERNAL_RATE/TIME_RESOLUTION)) + firstStart;
            controller.enqueue(new PcmAudioSnippet(start, sample));
            samplesRead += sampleCount;
        }
    }
    return new TransformStream({transform, close});
}

// fft on snippets, it is important snippets are of a sensible size for this
export function fft(addChannels = false) {
    async function transform(chunk, controller) {
        const fftChannels = [];
        const fft = new FFT(chunk.sample.length);
        // extract channels of chunk
        for(const channel of chunk.sample.channels()) {
            const out = fft.createComplexArray();
            const samples = fft.toComplexArray([...channel]);
            fft.transform(out, samples);

            const real = [];
            const imaginary = [];

            for (let i = 0; i < out.length; i += 2) {
                real.push(out[i]);
                imaginary.push(out[i+1]);
            }
            if (addChannels) fftChannels.push(samples);
            fftChannels.push(real, imaginary);
        }
        const sample = PcmAudioSample.fromChannels(fftChannels);
        controller.enqueue(new PcmAudioSnippet(chunk.start, sample));
    }
    return new TransformStream({transform});
}

export function extractSpectrum() {
    async function transform(chunk, controller) {
        const fftChannels = [];
        const fft = new FFT(chunk.sample.length);
        // go through channels pairwise and extract magnitude
        // also only half of the fft is actually spectrum data
        const spectra = [];
        for(let i = 0; i < chunk.sample.channelCount; i += 2) {
            const spectrum = [];
            const c2 = chunk.sample.channel(i+1);
            let j = 0;
            for (const s1 of chunk.sample.channel(i)) {
                if (j >= chunk.sample.length / 2) break;
                const s2 = c2.next().value;
                spectrum.push(Math.sqrt(s1*s1+s2*s2));
                j ++;
            }
            spectra.push(spectrum);
        }
        const sample = PcmAudioSample.fromChannels(spectra);
        controller.enqueue(new PcmAudioSnippet(chunk.start, sample));
    }
    return new TransformStream({transform});
}

export function ifft() {
    async function transform(chunk, controller) {
        const channels = [];
        const outputChannels = [];
        const fft = new FFT(chunk.sample.length);
        // extract channels of chunk
        for(const channel of chunk.sample.channels()) {
            channels.push([...channel]);
        }
        // go through channels pairwise
        for (let i = 0; i < channels.length; i += 2) {
            const real = channels[i];
            const imaginary = channels[i+1];
            const complexArr = real.map((v,i) => [v, imaginary[i]]).flat();
            const out = [];
            fft.inverseTransform(out, complexArr);
            const samples = fft.fromComplexArray(out);
            outputChannels.push(samples);
        }
        const sample = PcmAudioSample.fromChannels(outputChannels);
        controller.enqueue(new PcmAudioSnippet(chunk.start, sample));
    }
    return new TransformStream({transform});
}

export function window(f) {
    return map((v,i,t) => f(v,i,t)*v)
}

export function inverseWindow(f) {
    return map((v,i,t) => v/f(v,i,t))
}

export function blackman(a = 0.16) {
    return (s,i,t) => (1-a)/2 - (0.5) * Math.cos((2 * Math.PI * i)/t) + (a/2) * Math.cos((4 * Math.PI * i)/t);
}

export function hann(a = 0.5) {
    return (s,i,t) => Math.min(0.9999,a - (1-a) * Math.cos((2 * Math.PI * i)/t));
}
