/**
 * Functions which generate the sound splats themselves. Uses a port of the WebCanvas API for rendering.
 */


import { createCanvas} from "https://deno.land/x/canvas/mod.ts";
import * as Fs from "https://deno.land/std@0.204.0/fs/mod.ts";

const canvas = createCanvas(200, 200);
const ctx = canvas.getContext("2d");

ctx.fillStyle = "red";
ctx.fillRect(10, 10, 200 - 20, 200 - 20);

await Deno.writeFile("image.png", canvas.toBuffer());


export function imageFlash(width = 1024, height = 1024, innerRad = 100, clip = [0.2, 0.2]) {
    // expects a list of sound samples, if it just it will struggle, this is because it needs the total number of samples to render
    // outputs an object containing the image and time.
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    async function transform(chunk, controller) {
        try{
        ctx.fillStyle = `black`;
        ctx.fillRect(0,0,width, height);
        ctx.imageSmoothingEnabled = false;

        const start = chunk[0].start;
        const ns = chunk.length;
        const xc = width/2;
        const yc = height/2;
        const blocbRad = 4;
        const rt = Math.min(width, height)/2 - innerRad - blocbRad - 1;

        function lerp( a, b, alpha ) {
            return a + alpha * ( b - a )
        }
        
        const hue0 = 0;
        const hue1 = 240;

        chunk.forEach((c, Is) => {
            const sampleRange = [...c.sample.channel(0)].slice(clip[0]*ns,-(clip[1]*ns+1));
            const nf = sampleRange.length;
            const r = (rt*Is)/ns + innerRad;
            let If = 0;
            for(const s of sampleRange) {

                const a = (Math.PI*(If+0.5))/nf;
                const k = 3;
                const f = 2;
                const hue = Math.floor(lerp(hue0, hue1, If/nf));

                let grey = ((Math.log10(Math.abs(s))+3)/3)*100;
                grey = Math.min(Math.max(Math.floor(grey),0), 100)
                if (grey < 20) grey = 0;
                ctx.fillStyle = `hsla(0,0%,${grey}%, 0.5)`;
                const xs = r * Math.cos(a) + xc;
                const ys = r * Math.sin(a) + yc;
                ctx.beginPath();
                ctx.arc(xs, ys, blocbRad, 0, 2 * Math.PI, false);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(xs, yc-(ys-yc), blocbRad, 0, 2 * Math.PI, false);
                ctx.fill();
                If++;
            }
        });
        controller.enqueue({start, canvas});
        }
        catch(e) {
            console.log("error in canvas generaton")
        }
    }
    return new TransformStream({transform});
}

export function saveCanvas(path = "sound-drawing", header = "image") {
    const dir = path;
    const pathStart = `${dir}/${header}`;
    async function start(chunk, controller) {
        await Fs.ensureDir(dir);
    }
    async function write(chunk, controller) {
        console.log(`saving:${Math.floor(chunk.start)}`)
        await Deno.writeFile(pathStart + Math.floor(chunk.start) + ".png", chunk.canvas.toBuffer());
    }
    return new WritableStream({start, write});
}
