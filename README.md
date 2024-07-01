# Schienenmaus Click Splat Generator

## Introduction
This code generates diagrams referencing the reverberant response from a click
It finds and extracts clicks, analyses the change of amplitudes at frequencies over time and plots the data. It is designed using a streaming-first approach to allow it to be embedded into a website or used live. This version of process.js is for the bulk transformation of sound recordings.

## How to Run
This code uses Deno as its Javascript Runtime. Installation instructions for Deno may be found here: [Deno Install](https://docs.deno.com/runtime/manual/getting_started/installation/).

The code in this repository relies on a specific folder structure which is inculded under the data folder. Multiple runs may be included here and will be batch processed. Only one is inculded here to prevent the repository becoming too large.

The script can be run using the command: ```deno run -A process.js ./data```.
The splats will be inserted under ```./data/<run_number>/splats``` and are named according to the time the click occured.

Additional explanation can be found in the comments of the code in ```process.js``` and in the ```./lib``` folder.