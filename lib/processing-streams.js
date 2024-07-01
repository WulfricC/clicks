import { PcmAudioSnippet, PcmAudioSample, PCM_INTERNAL_RATE, TIME_RESOLUTION } from "./pcm.js";

export const EOSUB = Symbol("EOSUB");

export function timeProcessedStream() {
    async function transform(chunk, controller) {
        const message = `processed: ${(chunk.start + chunk.length).toFixed(2)}s`
        Deno.stdout.write(new TextEncoder().encode(message + "\r"));
        controller.enqueue(chunk);
    }
    return new TransformStream({transform});
}

export function envelope(envelopeFormula) {
    async function transform(chunk, controller) {
        
    }
    return new TransformStream({transform});
}

export function transform(lambda, time = v => v) {
    function transform(chunk, controller) {
        let sample;
        if (chunk instanceof PcmAudioSnippet) sample = chunk.sample;
        if (chunk instanceof PcmAudioSample) sample = chunk;

        const returnSample = lambda(sample);
        if (chunk instanceof PcmAudioSample)
            controller.enqueue(returnSample);
        if (chunk instanceof PcmAudioSnippet)
            controller.enqueue(new PcmAudioSnippet(time(chunk.start), returnSample));
    }
    return new TransformStream({transform});
}

export function mapChannels(lambda) {
    return transform(sample => new PcmAudioSample(sample.map(lambda)));
}

export function map(lambda) {
    return transform(sample => new PcmAudioSample(sample.map((s,i) => s.map(s => lambda(s,i,sample.length)))));
}

export function duration(ratio) {
    let aCount = 0;
    let bCount = 0;
    return transform(sample => {
        const channels = [...sample.channels];
        for(let i = 0; i < sample.channels.length; i++) {
            while (aCount*ratio - bCount > 1) {
                channels.splice(i-1,0,channels[i]);
                bCount ++;
                i ++;
            }
            while (aCount*ratio - bCount < -1) {
                i--;
                bCount --;
                channels.splice(i,1);
            }
            aCount ++
            bCount ++
        }
        return new PcmAudioSample(channels);
    },
    start => start * ratio
    )
}

class LevelBuffer extends Array {
    constructor(size, init = 0) {
        super(size);
        this.fill(init);
        this.total = init*size;
        this.previousTotal = this.total;
    }
    add(added) {
        this.push(added);
        const removed = this.shift();
        this.total += Math.abs(added) - Math.abs(removed);
        const toReturn = {level: this.level, roc:this.roc}
        this.previousTotal = this.total;
        return toReturn;
    }
    get level () {
        return this.total / this.length;
    }
    get roc() {
        return this.previousTotal / this.length - this.level;
    }
}

export function extractClicks(searchChannel = 0, sampleLength = 2000, smoothingSize = 128) {
    const levelBuf = new LevelBuffer(smoothingSize);
    let clickBuffer = [];
    let clickPosition = -1;
    let clickStartTime = 0;
    function transform(chunk, controller) {
        for (const v of chunk.sample.channel(searchChannel)) {
            const {level, roc} = levelBuf.add(v);
            if (clickPosition === -1 && roc*10000 > 15 && level > 0.05) {
                clickPosition= 0;
                clickStartTime = chunk.start - smoothingSize / (PCM_INTERNAL_RATE, TIME_RESOLUTION);
                clickBuffer.push(...levelBuf);
            }
            if (clickPosition >= 0) {
                clickBuffer.push(v);
                clickPosition ++;
            }
            if (clickPosition > sampleLength) {
                const sample = PcmAudioSample.fromChannels([clickBuffer]);
                clickBuffer = [];
                controller.enqueue(new PcmAudioSnippet(clickStartTime, sample));
                clickPosition = -1;
            }
        }
    }
    return new TransformStream({transform});
}

// runs a seperate transform stream for each chunk
// results are collected in a list which is then pushed onwards
// this allows processing streams to be used for seperate samples etc
export function subStream(streamInitialiser) {
    async function transform(chunk, controller) {
        const parentController = controller;
        const collection = [];
        if (!Array.isArray(chunk)) chunk = [chunk]
        let i = 0;
        const reader = new ReadableStream({
            pull: (controller) => {
                if (i >= chunk.length)
                    controller.close();
                else {
                    controller.enqueue(chunk[i])
                    i ++;
                }
            }
        });
        const writer = new WritableStream({
            write: (c) => collection.push(c),
            close: (c) => {
                if(collection.length === 1)
                    parentController.enqueue(collection[0]);
                else
                    parentController.enqueue(collection);
            }
        });
        await streamInitialiser(reader, writer);
    }
    return new TransformStream({transform});
}


// log content to the console
export function log() {
    async function transform(chunk, controller) {
        console.log(chunk);
        controller.enqueue(chunk);
    }
    return new TransformStream({transform});
}

// filter everyN
export function every(every = 1) {
    let count = 1;
    async function transform(chunk, controller) {
        if (count % every === 0)
            controller.enqueue(chunk);
        count ++;
    }
    return new TransformStream({transform});
}

export function logTo() {
    return new WritableStream({
        write: (c) => console.log(c)
    });
}



// concatenates lists of samples together

