import { BaseMatterAccessory } from './BaseMatterAccessory';
import { WiserPlatform } from '../platform';
import { WiserDevice, GroupSetEvent } from '../models';
import type { MatterAccessory } from 'homebridge';

export class WiserMatterSwitch extends BaseMatterAccessory {
  protected level = 0;
  protected previousLevel = 100;

  constructor(
    platform: WiserPlatform,
    device: WiserDevice,
    existingAccessory?: MatterAccessory,
    uuid?: string,
  ) {
    const displayName = typeof device.name !== 'undefined' ? device.name : `Switch ${device.id}`;
    const serialNumber = `${device.id}`.padStart(4, '0');

    super(platform, device, existingAccessory || {
      UUID: uuid!,
      displayName,
      deviceType: platform.api.matter!.deviceTypes.OnOffLight,
      serialNumber,
      manufacturer: 'Clipsal',
      model: 'Switch',
      firmwareRevision: '1.0.0',
      hardwareRevision: '1.0.0',
      clusters: {
        onOff: {
          onOff: false,
        },
      },
      handlers: {
        onOff: {
          on: async () => this.handleOnOff(true),
          off: async () => this.handleOnOff(false),
        },
      },
    });

    if (existingAccessory) {
      this.deviceType = platform.api.matter!.deviceTypes.OnOffLight;
      existingAccessory.handlers = {
        onOff: {
          on: async () => this.handleOnOff(true),
          off: async () => this.handleOnOff(false),
        },
      };
      this.handlers = existingAccessory.handlers;
    }

    // Initialize state
    if (!existingAccessory) {
      this.level = 0;
      if (this.clusters && this.clusters.onOff) {
        this.clusters.onOff.onOff = this.level > 0;
      }
    } else {
      if (this.clusters && this.clusters.onOff) {
        this.level = this.clusters.onOff.onOff ? 100 : 0;
      }
    }
  }

  protected async handleOnOff(value: boolean): Promise<void> {
    const targetLevel = value ? (this.previousLevel !== 0 ? this.previousLevel : 100) : 0;
    if (!value) {
      this.previousLevel = this.level;
    }
    this.logDebug(`Set on/off to ${value}, target level ${targetLevel}`);
    this.level = targetLevel;

    // Send command to Wiser
    this.wiser.setGroupLevel(
      this.device.wiserProjectGroup.address,
      this.toWiserLevel(targetLevel),
      this.device.wiserProjectGroup?.ramprate || 0,
    );

    // Update Matter state
    this.updateState('onOff', { onOff: value }).catch((err) => {
      this.logError('Failed to update state:', err);
    });
  }

  setStatusFromEvent(groupSetEvent: GroupSetEvent): void {
    this.level = this.toHomeKitLevel(groupSetEvent.level);
    this.logDebug(`Update switch status level to ${this.level}`);
    const isOn = this.level > 0;
    this.updateState('onOff', { onOff: isOn }).catch((err) => {
      this.logError('Failed to update state:', err);
    });
  }
}
