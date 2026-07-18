import { BaseMatterAccessory } from './BaseMatterAccessory';
import { WiserPlatform } from '../platform';
import { WiserDevice, GroupSetEvent } from '../models';
import type { MatterAccessory, MatterRequests } from 'homebridge';

export class WiserMatterBulb extends BaseMatterAccessory {
  protected level = 0;
  protected previousLevel = 100;

  constructor(
    platform: WiserPlatform,
    device: WiserDevice,
    existingAccessory?: MatterAccessory,
    uuid?: string,
  ) {
    const displayName = typeof device.name !== 'undefined' ? device.name : `Light ${device.id}`;
    const serialNumber = `${device.id}`.padStart(4, '0');

    const isDimmable = device.wiserProjectGroup.dimmable;

    super(platform, device, existingAccessory || {
      UUID: uuid!,
      displayName,
      deviceType: isDimmable
        ? platform.api.matter!.deviceTypes.DimmableLight
        : platform.api.matter!.deviceTypes.OnOffLight,
      serialNumber,
      manufacturer: 'Clipsal',
      model: isDimmable ? 'Dimmer' : 'Switch',
      firmwareRevision: '1.0.0',
      hardwareRevision: '1.0.0',
      clusters: {
        onOff: {
          onOff: false,
        },
        ...(isDimmable ? {
          levelControl: {
            currentLevel: 254,
            minLevel: 1,
            maxLevel: 254,
          },
        } : {}),
      },
      handlers: {
        onOff: {
          on: async () => this.handleOnOff(true),
          off: async () => this.handleOnOff(false),
        },
        ...(isDimmable ? {
          levelControl: {
            moveToLevelWithOnOff: async (request) => this.handleSetLevel(request),
          },
        } : {}),
      },
    });

    if (existingAccessory) {
      this.deviceType = isDimmable
        ? platform.api.matter!.deviceTypes.DimmableLight
        : platform.api.matter!.deviceTypes.OnOffLight;
      existingAccessory.handlers = {
        onOff: {
          on: async () => this.handleOnOff(true),
          off: async () => this.handleOnOff(false),
        },
        ...(isDimmable ? {
          levelControl: {
            moveToLevelWithOnOff: async (request) => this.handleSetLevel(request),
          },
        } : {}),
      };
      this.handlers = existingAccessory.handlers;
    }

    // Initialize state
    if (!existingAccessory) {
      this.level = 0;
      if (this.clusters) {
        if (this.clusters.onOff) {
          this.clusters.onOff.onOff = this.level > 0;
        }
        if (isDimmable && this.clusters.levelControl) {
          this.clusters.levelControl.currentLevel = Math.max(1, Math.round((this.level / 100) * 254));
        }
      }
    } else {
      if (this.clusters) {
        if (isDimmable && this.clusters.levelControl?.currentLevel !== undefined) {
          this.level = Math.round((this.clusters.levelControl.currentLevel / 254) * 100);
        } else if (this.clusters.onOff?.onOff) {
          this.level = 100;
        }
      }
    }
  }

  protected async handleOnOff(value: boolean): Promise<void> {
    const targetLevel = value ? (this.previousLevel !== 0 ? this.previousLevel : 100) : 0;
    if (!value) {
      this.previousLevel = this.level;
    }
    this.logDebug(`Set bulb on/off to ${value}, target level ${targetLevel}`);
    this.level = targetLevel;

    // Send command to Wiser
    this.wiser.setGroupLevel(
      this.device.wiserProjectGroup.address,
      this.toWiserLevel(targetLevel),
      this.device.wiserProjectGroup?.ramprate || 0,
    );

    // Update Matter state
    this.updateState('onOff', { onOff: value }).catch((err) => {
      this.logError('Failed to update onOff state:', err);
    });
    if (this.device.wiserProjectGroup.dimmable) {
      const matterLevel = Math.max(1, Math.round((targetLevel / 100) * 254));
      this.updateState('levelControl', { currentLevel: matterLevel }).catch((err) => {
        this.logError('Failed to update levelControl state:', err);
      });
    }
  }

  protected async handleSetLevel(request: MatterRequests.MoveToLevel): Promise<void> {
    this.logDebug(`MoveToLevel request: ${JSON.stringify(request)}`);
    const { level } = request;
    const percent = Math.round((level / 254) * 100);
    this.previousLevel = this.level;
    this.level = percent;

    this.wiser.setGroupLevel(
      this.device.wiserProjectGroup.address,
      this.toWiserLevel(percent),
      this.device.wiserProjectGroup?.ramprate || 0,
    );

    const isOn = percent > 0;
    this.updateState('onOff', { onOff: isOn }).catch((err) => {
      this.logError('Failed to update onOff state:', err);
    });
    this.updateState('levelControl', { currentLevel: level }).catch((err) => {
      this.logError('Failed to update levelControl state:', err);
    });
  }

  setStatusFromEvent(groupSetEvent: GroupSetEvent): void {
    this.level = this.toHomeKitLevel(groupSetEvent.level);
    this.logDebug(`Update bulb level to ${this.level}`);
    const isOn = this.level > 0;
    
    this.updateState('onOff', { onOff: isOn }).catch((err) => {
      this.logError('Failed to update onOff state:', err);
    });

    if (this.device.wiserProjectGroup.dimmable) {
      const matterLevel = Math.max(1, Math.round((this.level / 100) * 254));
      this.updateState('levelControl', { currentLevel: matterLevel }).catch((err) => {
        this.logError('Failed to update levelControl state:', err);
      });
    }
  }
}
