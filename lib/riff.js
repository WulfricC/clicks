/**
 * General library for reading and writing RIFF based files.
 * Libary by the Author.
 */


export class Block {
    constructor (file, position) {
        this.file = file;
        this.position = position;
        this.getTag = () => this.getStr(0, 4);
        this.getSize = () => this.getNumber(4, "uInt32");
        this.getEnd = async () => this.position + (await this.getSize()) + 8;
        this.setSize = (n) => this.setNumber(4, "uInt32", n);
    }
    async getStr(pos, len=4) {
        const buff = new ArrayBuffer(len);
        await this.file.seek(this.position + pos, Deno.SeekMode.Start);
        await this.file.read(new Uint8Array(buff));
        return new TextDecoder().decode(buff);
    }
    async setStr(pos, len=4, str) {
        const buff = new ArrayBuffer(len);
        new TextEncoder().encodeInto(str, new Uint8Array(buff));
        await this.file.seek(this.position + pos, Deno.SeekMode.Start);
        await this.file.write(new Uint8Array(buff));
    }
    async getNumber(pos, type) {
        const len = {uInt32:4, uInt16:2, uInt8:1}[type];
        const getter = {uInt32:"getUint32", uInt16:"getUint16", uInt8:"getUint8"}[type];
        const buff = new ArrayBuffer(len);
        await this.file.seek(this.position + pos, Deno.SeekMode.Start);
        await this.file.read(new Uint8Array(buff));
        const dataView = new DataView(buff);
        return dataView[getter](0, true);
    }
    async setNumber(pos, type, n) {
        const len = {uInt32:4, uInt16:2, uInt8:1}[type];
        const setter = {uInt32:"setUint32", uInt16:"setUint16", uInt8:"setUint8"}[type];
        const buff = new ArrayBuffer(len);
        const dataView = new DataView(buff);
        dataView[setter](0, n, true);
        await this.file.seek(this.position+pos, Deno.SeekMode.Start);
        await this.file.write(new Uint8Array(buff));
    }
    async readBuffer(pos, length) {
        //console.log("r", this.position+pos);
        const buff = new ArrayBuffer(length);
        await this.file.seek(this.position+pos, Deno.SeekMode.Start);
        await this.file.read(new Uint8Array(buff));
        return buff;
    }
    async writeBuffer(pos, buff) {
        //console.log("w", this.position+pos);
        await this.file.seek(this.position+pos, Deno.SeekMode.Start);
        await this.file.write(new Uint8Array(buff));
    }
}

export class Riff extends Block {
    constructor(file, position = 0) {
        super(file, position);
        this.getType = () => this.getStr(8, 4);
    }
    async write(type) {
        await this.setStr(0, 4, "RIFF");
        await this.setNumber(4, "uInt32", 0);
        await this.setStr(8, 4, type);
        return this.position + 12;
    }
    async *chunks() {
        const end = await this.getEnd();
        let pos = this.position + 12;
        let i = 0;
        while(pos < end) {
            const tag = await this.getStr(pos, 4);
            const length = await this.getNumber(pos + 4, "uInt32");
            yield {
                tag, 
                position: pos, 
            };
            i ++;
            pos += length + 8;
        }
    }
}

export class DataBlock extends Block {
    offset = 8;
    readStream(chunkSize = (1<<16)){
        let size, position;
        const offset = this.offset;
        const block = this;

        async function start(controller) {
            size = await block.getSize();
            position = 0;
        }

        async function pull(controller) {
            if (position >= size) {
                controller.close();
            }
            else {
                const bytesToRead = Math.min(size - position, chunkSize);
                const buffer = await block.readBuffer(position + offset, bytesToRead);
                //console.log("r", position, buffer.byteLength);
                controller.enqueue(new DataChunk(position, buffer));
                position += bytesToRead;
            }
            
        }

        return new ReadableStream({start, pull});
    }
    writeStream(onComplete) {
        const offset = this.offset;
        const block = this;
        let size = 0;
        async function write(chunk, controller) {
            //if (!(chunk instanceof DataChunk)) return;
            const max = [...new Int16Array(chunk.buffer)].reduce((s, v) => Math.max(s,v), 0);
            const min = [...new Int16Array(chunk.buffer)].reduce((s, v) => Math.min(s,v), 0);
            await block.writeBuffer(chunk.position + offset, chunk.buffer);
            size = Math.max(size, chunk.position + chunk.buffer.byteLength);
            
        }
        async function close(controller) {
            await block.setSize(size);
            if (typeof onComplete === "function")
                await onComplete();
        }
        return new WritableStream({write, close});          
    }
    async write(data) {
        await this.setStr(0, 4, "data");
        if (data === undefined) {
            await this.setNumber(4, "uInt32", 0);
            return undefined;
        }
        else {
            await this.setNumber(4, "uInt32", data.byteLength);
            await this.writeBuffer(8, data);
            return this.position + 8 + data.byteLength;
        }
    }
}

export class DataChunk {
    constructor(position, buffer) {
        this.position = position;
        this.buffer = buffer;
    }
}