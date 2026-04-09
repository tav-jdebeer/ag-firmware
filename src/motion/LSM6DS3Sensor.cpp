#include "LSM6DS3Sensor.h"
#include "NodeDB.h"

#ifdef HAS_IMU_DETECTION
#include <Wire.h>
#endif

#if !defined(ARCH_STM32WL) && !MESHTASTIC_EXCLUDE_I2C && __has_include(<Adafruit_LSM6DS3TRC.h>)

LSM6DS3Sensor::LSM6DS3Sensor(ScanI2C::FoundDevice foundDevice) : MotionSensor::MotionSensor(foundDevice) {}

bool LSM6DS3Sensor::init()
{
    if (sensor.begin_I2C(deviceAddress())) {

        // Default threshold of 2G, less sensitive options are 4, 8 or 16G
        sensor.setAccelRange(LSM6DS_ACCEL_RANGE_2_G);

        // Duration is number of occurrences needed to trigger, higher threshold is less sensitive
        sensor.enableWakeup(config.display.wake_on_tap_or_motion, 1, LSM6DS3_WAKE_THRESH);

        LOG_DEBUG("LSM6DS3 init ok");
        return true;
    }
    LOG_DEBUG("LSM6DS3 init failed");
    return false;
}

int32_t LSM6DS3Sensor::runOnce()
{
    if (sensor.shake()) {
        wakeScreen();
        return 500;
    }
    return MOTION_SENSOR_CHECK_INTERVAL_MS;
}

#ifdef HAS_IMU_DETECTION
bool LSM6DS3Sensor::initForDetection(uint8_t threshold)
{
    // Power on IMU with high-drive GPIO (Seeed BSP beginCore() sequence)
    // P1.08 = IMU_PWR_PIN (D15)
    NRF_P1->PIN_CNF[8] = ((uint32_t)NRF_GPIO_PIN_DIR_OUTPUT << GPIO_PIN_CNF_DIR_Pos)
                        | ((uint32_t)NRF_GPIO_PIN_INPUT_DISCONNECT << GPIO_PIN_CNF_INPUT_Pos)
                        | ((uint32_t)NRF_GPIO_PIN_NOPULL << GPIO_PIN_CNF_PULL_Pos)
                        | ((uint32_t)NRF_GPIO_PIN_H0H1 << GPIO_PIN_CNF_DRIVE_Pos)
                        | ((uint32_t)NRF_GPIO_PIN_NOSENSE << GPIO_PIN_CNF_SENSE_Pos);
    digitalWrite(IMU_PWR_PIN, HIGH);
    delay(20);

    IMU_WIRE.begin();
    Adafruit_LSM6DS3TRC imu;

    if (!imu.begin_I2C(LSM6DS_I2CADDR_DEFAULT, &IMU_WIRE)) {
        LOG_ERROR("IMU detection init failed: I2C begin failed");
        IMU_WIRE.end();
        return false;
    }

    // Low-power accel config (~2uA): 2G range, 12.5Hz ODR, gyro off
    imu.setAccelRange(LSM6DS_ACCEL_RANGE_2_G);
    imu.setAccelDataRate(LSM6DS_RATE_12_5_HZ);
    imu.setGyroDataRate(LSM6DS_RATE_SHUTDOWN);

    // Configure wake-up detection with threshold
    imu.enableWakeup(true, 1, threshold);

    // Enable latch mode (TAP_CFG bit 0 = LIR) so INT1 stays asserted
    // until WAKE_UP_SRC is read. From Seeed FreeFallDetect example pattern.
    // Direct I2C register read-modify-write since i2c_dev is protected.
    IMU_WIRE.beginTransmission(LSM6DS_I2CADDR_DEFAULT);
    IMU_WIRE.write(LSM6DS_TAP_CFG);
    IMU_WIRE.endTransmission(false);
    IMU_WIRE.requestFrom((uint8_t)LSM6DS_I2CADDR_DEFAULT, (uint8_t)1);
    uint8_t tapCfgVal = IMU_WIRE.read();
    tapCfgVal |= 0x01; // Set LIR bit
    IMU_WIRE.beginTransmission(LSM6DS_I2CADDR_DEFAULT);
    IMU_WIRE.write(LSM6DS_TAP_CFG);
    IMU_WIRE.write(tapCfgVal);
    IMU_WIRE.endTransmission();

    // Route wake-up event to INT1 pin (MD1_CFG bit 5)
    imu.configInt1(false, false, false, false, true);

    // INT1 active-high, push-pull
    imu.configIntOutputs(false, false);

    IMU_WIRE.end(); // IMU runs autonomously, no further I2C needed

    LOG_INFO("IMU configured for motion detection: threshold=%d, INT1 on pin %d", threshold, IMU_INT1_PIN);
    return true;
}
#endif

#endif