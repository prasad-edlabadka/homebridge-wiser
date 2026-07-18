import { BaseMatterAccessory } from './BaseMatterAccessory';
import { WiserPlatform } from '../platform';
import { WiserDevice, GroupSetEvent } from '../models';
import type { MatterAccessory } from 'homebridge';

export class WiserMatterAC extends BaseMatterAccessory {
  protected level = 0;
  protected temperature = 22;
  protected fan = 0;

  private temperatureConverstion = {
    '16': 15, '18': 17, '20': 20, '22': 22, '24': 25, '26': 28, '28': 30,
  };

  private fanConverstion = {
    '1': 2, '2': 5, '0': 7,
  };

  constructor(
    platform: WiserPlatform,
    device: WiserDevice,
    existingAccessory?: MatterAccessory,
    uuid?: string,
  ) {
    const displayName = typeof device.name !== 'undefined' ? device.name : `AC ${device.id}`;
    const serialNumber = `${device.id}`.padStart(4, '0');

    super(platform, device, existingAccessory || {
      UUID: uuid!,
      displayName,
      deviceType: platform.api.matter!.deviceTypes.Thermostat,
      serialNumber,
      manufacturer: 'Mitsubishi Electric',
      model: 'Wide & Long',
      firmwareRevision: '1.0.0',
      hardwareRevision: '1.0.0',
      clusters: {
        thermostat: {
          externalMeasuredIndoorTemperature: 2200,
          occupiedCoolingSetpoint: 2200,
          minCoolSetpointLimit: 1600,
          maxCoolSetpointLimit: 2800,
          controlSequenceOfOperation: 0,
          systemMode: 0,
          presetTypes: [
            {
              presetScenario: platform.api.matter!.types.Thermostat.PresetScenario.Occupied,
              numberOfPresets: 1,
              presetTypeFeatures: {
                automatic: false,
                supportsNames: false,
              },
            },
          ],
          numberOfPresets: 1,
          presets: [],
          activePresetHandle: null,
        } as any,
        fanControl: {
          fanMode: platform.api.matter!.types.FanControl.FanMode.Off,
          fanModeSequence: platform.api.matter!.types.FanControl.FanModeSequence.OffHigh,
          percentSetting: 0,
          percentCurrent: 0,
        },
      },
      handlers: {
        thermostat: {
          systemModeChange: async (request) => this.handleSystemModeChange(request),
          occupiedCoolingSetpointChange: async (request) => this.handleCoolingSetpointChange(request),
        },
        fanControl: {
          fanModeChange: async (request) => this.handleFanModeChange(request),
          percentSettingChange: async (request) => this.handlePercentSettingChange(request),
        },
      },
    });

    if (existingAccessory) {
      this.deviceType = platform.api.matter!.deviceTypes.Thermostat;
      existingAccessory.handlers = {
        thermostat: {
          systemModeChange: async (request) => this.handleSystemModeChange(request),
          occupiedCoolingSetpointChange: async (request) => this.handleCoolingSetpointChange(request),
        },
        fanControl: {
          fanModeChange: async (request) => this.handleFanModeChange(request),
          percentSettingChange: async (request) => this.handlePercentSettingChange(request),
        },
      };
      this.handlers = existingAccessory.handlers;
    }

    // Initialize state
    if (!existingAccessory) {
      this.level = 10;
      this.temperature = 22;
      this.fan = 0;

      if (this.clusters) {
        if (this.clusters.thermostat) {
          this.clusters.thermostat.systemMode = this.level === 12 ? 3 : 0;
          this.clusters.thermostat.occupiedCoolingSetpoint = this.temperature * 100;
          this.clusters.thermostat.externalMeasuredIndoorTemperature = this.temperature * 100;
        }
        if (this.clusters.fanControl) {
          this.clusters.fanControl.fanMode = this.getFanModeFromWiser(this.fan);
          this.clusters.fanControl.percentSetting = this.fan * 33;
          this.clusters.fanControl.percentCurrent = this.fan * 33;
        }
      }
    } else {
      if (this.clusters) {
        if (this.clusters.thermostat?.systemMode !== undefined) {
          this.level = this.clusters.thermostat.systemMode === 3 ? 12 : 10;
        }
        if (this.clusters.thermostat?.occupiedCoolingSetpoint !== undefined) {
          this.temperature = Math.round(this.clusters.thermostat.occupiedCoolingSetpoint / 100);
        }
        if (this.clusters.fanControl?.percentSetting !== undefined && this.clusters.fanControl.percentSetting !== null) {
          this.fan = Math.round(this.clusters.fanControl.percentSetting / 33);
        }
      }
    }
  }

  private getFanModeFromWiser(wiserFan: number): number {
    const fanMode = this.platform.api.matter!.types.FanControl.FanMode;
    if (wiserFan === 0) {
      return fanMode.Off;
    } else if (wiserFan === 1) {
      return fanMode.Low;
    } else if (wiserFan === 2) {
      return fanMode.Medium;
    } else {
      return fanMode.High;
    }
  }

  protected async handleSystemModeChange(request: { systemMode: number, oldSystemMode: number }): Promise<void> {
    this.logDebug(`SystemMode change request: ${JSON.stringify(request)}`);
    const active = request.systemMode !== 0;
    const targetLevel = active ? 12 : 10;
    this.level = targetLevel;

    this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, targetLevel);

    this.updateState('thermostat', { systemMode: request.systemMode }).catch((err) => {
      this.logError('Failed to update system mode state:', err);
    });
  }

  protected async handleCoolingSetpointChange(request: { occupiedCoolingSetpoint: number, oldOccupiedCoolingSetpoint: number }): Promise<void> {
    this.logDebug(`CoolingSetpoint change request: ${JSON.stringify(request)}`);
    const celsius = Math.round(request.occupiedCoolingSetpoint / 100);
    const validTemps = [16, 18, 20, 22, 24, 26, 28];
    const closest = validTemps.reduce((prev, curr) => 
      Math.abs(curr - celsius) < Math.abs(prev - celsius) ? curr : prev
    );

    this.temperature = closest;
    const level = this.temperatureConverstion[`${closest}`] || 22;

    this.logDebug(`Target temperature: ${closest}°C, setting Wiser level: ${level}`);
    this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, level);

    this.updateState('thermostat', {
      occupiedCoolingSetpoint: closest * 100,
      externalMeasuredIndoorTemperature: closest * 100,
    }).catch((err) => {
      this.logError('Failed to update cooling setpoint state:', err);
    });
  }

  protected async handleFanModeChange(request: { fanMode: number, oldFanMode: number }): Promise<void> {
    this.logDebug(`FanMode change request: ${JSON.stringify(request)}`);
    const fanMode = this.platform.api.matter!.types.FanControl.FanMode;
    let speed = 0;
    if (request.fanMode === fanMode.Low) {
      speed = 1;
    } else if (request.fanMode === fanMode.Medium) {
      speed = 2;
    } else if (request.fanMode === fanMode.High || request.fanMode === fanMode.On) {
      speed = 3;
    }

    this.fan = speed;
    const level = this.fanConverstion[`${speed}`] || 7;

    this.logDebug(`Target fan speed: ${speed}, setting Wiser level: ${level}`);
    this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, level);

    this.updateState('fanControl', {
      fanMode: request.fanMode,
      percentSetting: speed * 33,
      percentCurrent: speed * 33,
    }).catch((err) => {
      this.logError('Failed to update fan mode state:', err);
    });
  }

  protected async handlePercentSettingChange(request: { percentSetting: number | null, oldPercentSetting: number | null }): Promise<void> {
    this.logDebug(`PercentSetting change request: ${JSON.stringify(request)}`);
    const percent = request.percentSetting ?? 0;
    let speed = 0;
    if (percent > 0 && percent <= 33) {
      speed = 1;
    } else if (percent > 33 && percent <= 66) {
      speed = 2;
    } else if (percent > 66) {
      speed = 3;
    }

    this.fan = speed;
    const level = this.fanConverstion[`${speed}`] || 7;

    this.logDebug(`Target fan speed (from percent): ${speed}, setting Wiser level: ${level}`);
    this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, level);

    const mode = this.getFanModeFromWiser(speed);
    this.updateState('fanControl', {
      percentSetting: percent,
      percentCurrent: percent,
      fanMode: mode,
    }).catch((err) => {
      this.logError('Failed to update percent setting state:', err);
    });
  }

  setStatusFromEvent(groupSetEvent: GroupSetEvent): void {
    this.level = groupSetEvent.level;
    this.logDebug(`Update AC Status level to ${this.level}`);

    if (this.level === 12 || this.level === 10) {
      const mode = this.level === 12 ? 3 : 0;
      this.updateState('thermostat', { systemMode: mode }).catch((err) => {
        this.logError('Failed to update systemMode:', err);
      });
    } else {
      for (const [tempStr, lvl] of Object.entries(this.temperatureConverstion)) {
        if (lvl === this.level) {
          const temp = parseInt(tempStr);
          this.temperature = temp;
          this.updateState('thermostat', {
            occupiedCoolingSetpoint: temp * 100,
            externalMeasuredIndoorTemperature: temp * 100,
          }).catch((err) => {
            this.logError('Failed to update target temperature:', err);
          });
          break;
        }
      }

      for (const [fanStr, lvl] of Object.entries(this.fanConverstion)) {
        if (lvl === this.level) {
          const speed = parseInt(fanStr);
          this.fan = speed;
          const mode = this.getFanModeFromWiser(speed);
          this.updateState('fanControl', {
            fanMode: mode,
            percentSetting: speed * 33,
            percentCurrent: speed * 33,
          }).catch((err) => {
            this.logError('Failed to update fan speed:', err);
          });
          break;
        }
      }
    }
  }
}
