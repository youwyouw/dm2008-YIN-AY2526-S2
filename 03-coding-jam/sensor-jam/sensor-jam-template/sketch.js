let port; // Serial communication port
let connectBtn;

let sensorVal;
let circleSize = 50;
let targetSize = 50;

function setup() {
  createCanvas(windowWidth, windowHeight);
  port = createSerial(); // creates the serial port

  // Connection helpers
  connectBtn = createButton("Connect to Arduino");
  connectBtn.position(20, 20);
  connectBtn.mousePressed(connectBtnClick);

  colorMode(HSB, 360, 100, 100, 1);
}

function draw() {
  // === Motion blur (fluid feel) ===
  background(0, 0, 0, 0.08);

  // === Additive glow (key VJ technique) ===
  blendMode(ADD);

  let t = millis() * 0.002;

  // === Color (driven by sensor) ===
  let hue = map(circleSize, 0, 500, 0, 360);
  fill(hue, 80, 100, 0.6);
  noStroke();

  let spacing = width / 4;

  // === Spatial distortion (structure driven by sensor) ===
  let distortion = map(circleSize, 0, 500, -150, 50);

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {

      let x = width / 4 + j * spacing + sin(t + i) * distortion;
      let y = height / 4 + i * spacing + cos(t + j) * distortion;

      // === Breathing rhythm (phase offset) ===
      let offset = sin(t + i * 0.5 + j * 0.5) * 30;

      ellipse(x, y, circleSize + offset);
    }
  }

  // === Subtle border flicker (club feel) ===
  blendMode(BLEND);
  stroke(255, 0.05);
  noFill();
  rect(0, 0, width, height);

  // === Serial read ===
  if (port.opened()) {
    sensorVal = port.readUntil("\n");

    if (sensorVal[0]) {
      console.log(sensorVal);

      targetSize = float(sensorVal);
      circleSize = lerp(circleSize, targetSize, 0.1);
    }
  }
}

// DO NOT REMOVE THIS FUNCTION
function connectBtnClick(e) {
  if (!port.opened()) {
    port.open(9600);
    e.target.innerHTML = "Disconnect Arduino";
    e.target.classList.add("connected");
  } else {
    port.close();
    e.target.innerHTML = "Connect to Arduino";
    e.target.classList.remove("connected");
  }
}