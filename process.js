/**
 * Code for generating the sound splats seen in the drawings.
 * All libraries in ./lib aside from the 'fft' library were also
 * written by the author.
 * 
 * The code runs on Deno using the command > deno run -A process.js ./data
 * Images will be saved in ./data/<number>/splats
 * Image filenames use the time the click occured as their filenames to allow for syncing up with other data
 * 
 * The code heavily relies on the JavaScript streaming API to allow it to handle the large files we recorded whilst
 * measuring with the Schienenmaus.
 * 
 * See ./lib/sound-drawing.js for the more detailed implementation of the drawing
 */

import {Wav} from "./lib/wav.js";
import {extractClicks, subStream, every } from "./lib/processing-streams.js";
import { resizeSnippets, fft, window, hann , extractSpectrum} from "./lib/analysis.js";
import { imageFlash, saveCanvas} from "./lib/sound-drawing.js";

import * as Path from "https://deno.land/std@0.204.0/path/mod.ts";
import * as Fs from "https://deno.land/std@0.204.0/fs/mod.ts";

// sustream to sample click frequencies over time
const extractFrequency = (input, output) => input
    .pipeThrough(resizeSnippets(256))
    .pipeThrough(window(hann()))
    .pipeThrough(fft())
    .pipeThrough(extractSpectrum())
    .pipeTo(output)

// main stream
const process = async (wavReader, imageDirPath) => await wavReader
    .pipeThrough(extractClicks(0,1024*20))
    .pipeThrough(every(2))
    .pipeThrough(subStream(extractFrequency))
    .pipeThrough(imageFlash())
    .pipeTo(saveCanvas(imageDirPath, ""));

// process all the files in directory and save splats
const dir = Deno.args[0];

for await (const entry of Deno.readDir(dir)) {
    if (!(entry.isDirectory && /\d+/.test(entry.name)))
        continue;
    console.log("processing ", entry.name)
    const audioPath = Path.join(dir, entry.name, "audio.wav");
    if (! await Fs.exists(audioPath)) continue;
    const wavReader = await Wav.readStreamFile(audioPath, (1<<13));
    await process(wavReader, Path.join(dir, entry.name, "splats"));
}






