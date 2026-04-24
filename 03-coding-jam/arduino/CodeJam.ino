// Ultrasonic Sensor → LED Brightness
// Closer the object, brighter the LED

int usSensorPin = A0;  // select input pin

float usMaxRange = 520.0;
float dataSize = 1023.0;  // 10-bit data

float sensorVal, distVal;

//int brightness = 0;

void setup() {
  // Begin serial communication
  Serial.begin(9600);
}

void loop() {
  // read the value from the sensor:
  sensorVal = analogRead(usSensorPin);

  distVal = sensorVal * usMaxRange / dataSize;

  // clamp min and max distances
  if (distVal < 2) {
    distVal = 2;
  }
  if (distVal > 500) {
    distVal = 500;
  }

  // map distance to brightess, and constrain
  //brightness = map(distVal, 2, 500, 0, 255);
  //brightness = constrain(brightness, 0, 255);

  Serial.println(distVal);
  //Serial.println("cm");

  //Serial.print("Brightness is at:");
  //Serial.println(brightness);

  delay(100);
}
