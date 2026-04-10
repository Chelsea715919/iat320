# iat320
code for circuit
#include <bluefruit.h>
#include <Adafruit_CircuitPlayground.h>
#include <math.h>

BLEDis bledis;
BLEUart bleuart;
BLEBas blebas;

const uint32_t SEND_INTERVAL_MS = 20;
uint32_t lastSendMs = 0;

float prevX = 0.0f;
float prevY = 0.0f;
float prevZ = 0.0f;

float smoothDx = 0.0f;
float smoothDy = 0.0f;
float smoothDz = 0.0f;
float smoothEnergy = 0.0f;

const float DELTA_SMOOTH = 0.35f;
const float ENERGY_SMOOTH = 0.45f;
const float AXIS_GAIN = 5.2f;
const float ENERGY_SCALE = 3.0f;
const float DEADZONE = 0.05f;
const float MAX_DELTA = 1.8f;

void startAdvertising() {
  Bluefruit.Advertising.stop();
  Bluefruit.ScanResponse.clearData();

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(bleuart);
  Bluefruit.ScanResponse.addName();

  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.start(0);
}

float clampFloat(float v, float minV, float maxV) {
  if (v < minV) return minV;
  if (v > maxV) return maxV;
  return v;
}

float applyDeadzone(float v, float zone) {
  return fabsf(v) < zone ? 0.0f : v;
}

void resetBaseline() {
  prevX = CircuitPlayground.motionX();
  prevY = CircuitPlayground.motionY();
  prevZ = CircuitPlayground.motionZ();

  smoothDx = 0.0f;
  smoothDy = 0.0f;
  smoothDz = 0.0f;
  smoothEnergy = 0.0f;
}

void setup() {
  Serial.begin(115200);
  delay(300);

  CircuitPlayground.begin();
  CircuitPlayground.setBrightness(20);

  Bluefruit.begin();
  Bluefruit.setTxPower(4);
  Bluefruit.setName("NeuroCanvas_CPB");

  bledis.setManufacturer("Adafruit");
  bledis.setModel("Circuit Playground Bluefruit");
  bledis.begin();

  blebas.begin();
  blebas.write(100);

  bleuart.begin();
  startAdvertising();
  resetBaseline();
}

void loop() {
  if (millis() - lastSendMs < SEND_INTERVAL_MS) return;
  lastSendMs = millis();

  float x = CircuitPlayground.motionX();
  float y = CircuitPlayground.motionY();
  float z = CircuitPlayground.motionZ();

  float dx = (x - prevX) * AXIS_GAIN;
  float dy = (y - prevY) * AXIS_GAIN;
  float dz = (z - prevZ) * AXIS_GAIN;

  prevX = x;
  prevY = y;
  prevZ = z;

  dx = clampFloat(applyDeadzone(dx, DEADZONE), -MAX_DELTA, MAX_DELTA);
  dy = clampFloat(applyDeadzone(dy, DEADZONE), -MAX_DELTA, MAX_DELTA);
  dz = clampFloat(applyDeadzone(dz, DEADZONE), -MAX_DELTA, MAX_DELTA);

  smoothDx = smoothDx * DELTA_SMOOTH + dx * (1.0f - DELTA_SMOOTH);
  smoothDy = smoothDy * DELTA_SMOOTH + dy * (1.0f - DELTA_SMOOTH);
  smoothDz = smoothDz * DELTA_SMOOTH + dz * (1.0f - DELTA_SMOOTH);

  float energy = sqrtf(dx * dx + dy * dy + dz * dz) * ENERGY_SCALE;
  smoothEnergy = smoothEnergy * ENERGY_SMOOTH + energy * (1.0f - ENERGY_SMOOTH);
  smoothEnergy = clampFloat(smoothEnergy, 0.0f, 6.0f);

  float outDx = clampFloat(smoothDx / MAX_DELTA, -1.0f, 1.0f);
  float outDy = clampFloat(smoothDy / MAX_DELTA, -1.0f, 1.0f);
  float outDz = clampFloat(smoothDz / MAX_DELTA, -1.0f, 1.0f);

  if (Bluefruit.connected()) {
    char packet[32];
    snprintf(packet, sizeof(packet), "%.2f,%.2f,%.2f,%.1f\n",
      outDx, outDy, outDz, smoothEnergy);
    bleuart.print(packet);
  }

  Serial.print(outDx, 2);
  Serial.print(",");
  Serial.print(outDy, 2);
  Serial.print(",");
  Serial.print(outDz, 2);
  Serial.print(",");
  Serial.println(smoothEnergy, 1);
}
