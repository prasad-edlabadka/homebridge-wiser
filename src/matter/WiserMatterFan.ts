import { BaseMatterAccessory } from './BaseMatterAccessory';
import { WiserPlatform } from '../platform';
import { WiserDevice, GroupSetEvent } from '../models';
import type { MatterAccessory } from 'homebridge';

export class WiserMatterFan extends BaseMatterAccessory {
  protected level = 0;
  protected previousLevel = 100;

  constructor(
    platform: WiserPlatform,
    device: WiserDevice,
    existingAccessory?: MatterAccessory,
    uuid?: string,
  ) {
    const displayName = typeof device.name !== 'undefined' ? device.name : `Fan ${device.id}`;
    const serialNumber = `${device.id}`.padStart(4, '0');

    super(platform, device, existingAccessory || {
      UUID: uuid!,
      displayName,
      deviceType: platform.api.matter!.deviceTypes.Fan,
      serialNumber,
      manufacturer: 'Clipsal',
      model: 'Fan',
      firmwareRevision: '1.0.0',
      hardwareRevision: '1.0.0',
      clusters: {
        fanControl: {
          fanMode: platform.api.matter!.types.FanControl.FanMode.Off,
          fanModeSequence: platform.api.matter!.types.FanControl.FanModeSequence.OffHigh,
          percentSetting: 0,
          percentCurrent: 0,
        },
      },
      handlers: {
        fanControl: {
          fanModeChange: async (request) => this.handleFanModeChange(request),
          percentSettingChange: async (request) => this.handlePercentSettingChange(request),
        },
      },
    });

    if (existingAccessory) {
      this.deviceType = platform.api.matter!.deviceTypes.Fan;
      existingAccessory.handlers = {
        fanControl: {
          fanModeChange: async (request) => this.handleFanModeChange(request),
          percentSettingChange: async (request) => this.handlePercentSettingChange(request),
        },
      };
      this.handlers = existingAccessory.handlers;
    }

    // Initialize state
    if (!existingAccessory) {
      this.level = 0;
      if (this.clusters && this.clusters.fanControl) {
        this.clusters.fanControl.percentSetting = this.level;
        this.clusters.fanControl.percentCurrent = this.level;
        this.clusters.fanControl.fanMode = this.getFanModeFromPercent(this.level);
      }
    } else {
      if (this.clusters && this.clusters.fanControl?.percentSetting !== undefined && this.clusters.fanControl.percentSetting !== null) {
        this.level = this.clusters.fanControl.percentSetting;
      }
    }
  }

  private getFanModeFromPercent(percent: number): number {
    const fanMode = this.platform.api.matter!.types.FanControl.FanMode;
    if (percent === 0) {
      return fanMode.Off;
    } else if (percent <= 33) {
      return fanMode.Low;
    } else if (percent <= 66) {
      return fanMode.Medium;
    } else {
      return fanMode.High;
    }
  }

  private getPercentFromFanMode(mode: number): number {
    const fanMode = this.platform.api.matter!.types.FanControl.FanMode;
    switch (mode) {
      case fanMode.Off:
        return 0;
      case fanMode.Low:
        return 33;
      case fanMode.Medium:
        return 66;
      case fanMode.High:
      case fanMode.On:
        return 100;
      default:
        return 0;
    }
  }

  protected async handleFanModeChange(request: { fanMode: number, oldFanMode: number }): Promise<void> {
    this.logDebug(`FanMode change request: ${JSON.stringify(request)}`);
    const percent = this.getPercentFromFanMode(request.fanMode);
    
    if (percent === 0) {
      this.previousLevel = this.level || 100;
    }
    this.level = percent;

    this.wiser.setGroupLevel(
      this.device.wiserProjectGroup.address,
      this.toWiserLevel(percent),
      this.device.wiserProjectGroup?.ramprate || 0,
    );

    this.updateState('fanControl', {
      fanMode: request.fanMode,
      percentSetting: percent,
      percentCurrent: percent,
    }).catch((err) => {
      this.logError('Failed to update fan control state:', err);
    });
  }

  protected async handlePercentSettingChange(request: { percentSetting: number | null, oldPercentSetting: number | null }): Promise<void> {
    this.logDebug(`PercentSetting change request: ${JSON.stringify(request)}`);
    const percent = request.percentSetting ?? 0;
    if (percent === 0) {
      this.previousLevel = this.level || 100;
    }
    this.level = percent;

    this.wiser.setGroupLevel(
      this.device.wiserProjectGroup.address,
      this.toWiserLevel(percent),
      this.device.wiserProjectGroup?.ramprate || 0,
    );

    const mode = this.getFanModeFromPercent(percent);
    this.updateState('fanControl', {
      percentSetting: percent,
      percentCurrent: percent,
      fanMode: mode,
    }).catch((err) => {
      this.logError('Failed to update fan control state:', err);
    });
  }

  setStatusFromEvent(groupSetEvent: GroupSetEvent): void {
    this.level = this.toHomeKitLevel(groupSetEvent.level);
    this.logDebug(`Update fan speed level to ${this.level}`);
    const mode = this.getFanModeFromPercent(this.level);

    this.updateState('fanControl', {
      percentSetting: this.level,
      percentCurrent: this.level,
      fanMode: mode,
    }).catch((err) => {
      this.logError('Failed to update fan control state:', err);
    });
  }
}
