# Sensor-Driven VJ Visualizer

A live visual instrument built with p5.js and Arduino. A physical sensor feeds real-time data over serial into the sketch, warping a 3×3 grid of glowing orbs — their color, size, and spatial arrangement all respond to what you touch, squeeze, or move.

## How It Works

The sketch runs a 3×3 grid of ellipses animated with sine/cosine oscillation. Each frame, it reads a numeric value from the Arduino over serial (9600 baud) and smoothly interpolates the circle size toward that target using `lerp`. That single number cascades into three visual dimensions simultaneously:

- **Color** — hue shifts across the full spectrum (0–360°) as the sensor value rises
- **Size & breathing** — each orb pulses with a per-cell phase offset, so the grid breathes organically rather than in unison
- **Spatial distortion** — the grid warps and contracts based on sensor intensity, pulling orbs toward or away from the center

Motion blur is achieved by drawing a semi-transparent black background each frame (alpha 0.08) rather than clearing it. Additive blend mode stacks the glow so overlapping orbs bloom brighter, giving the output a club-ready luminance feel.

## Requirements

- [p5.js](https://p5js.org/) with the `p5.WebSerial` library
- Arduino (or any microcontroller) sending a numeric value followed by `\n` at 9600 baud
- A browser that supports the Web Serial API (Chrome / Edge)

## Setup

1. Upload your sensor sketch to the Arduino. The serial output should look like:
   ```
   247
   251
   238
   ```
2. Open the p5.js sketch in a Web Serial-compatible browser.
3. Click **Connect to Arduino** and select your port.
4. Move / squeeze / interact with the sensor to drive the visuals.

## Controls

| Input | Effect |
|---|---|
| Sensor low → high | Orbs grow, hue shifts, grid expands outward |
| Sensor high → low | Orbs shrink, cooler hues, grid pulls inward |
| Connect button | Opens / closes the serial port |