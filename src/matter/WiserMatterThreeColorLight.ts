import { BaseMatterAccessory } from './BaseMatterAccessory';
import { WiserPlatform } from '../platform';
import { WiserDevice, GroupSetEvent } from '../models';
import type { MatterAccessory } from 'homebridge';

export class WiserMatterThreeColorLight extends BaseMatterAccessory {
  private temperature = 140;
  private defaultColor = 'cool_white';
  private sequence = ['cool_white', 'warm_white', 'day_white'];
  private state = false;
  private temperatureReset = false;
  private onOffMatrix: Record<string, Record<string, number>> = {};
  private resetTimeout: NodeJS.Timeout | null = null;

  constructor(
    platform: WiserPlatform,
    device: WiserDevice,
    existingAccessory?: MatterAccessory,
    uuid?: string,
  ) {
    const displayName = typeof device.name !== 'undefined' ? device.name : `Light ${device.id}`;
    const serialNumber = `${device.id}`.padStart(4, '0');

    super(platform, device, existingAccessory || {
      UUID: uuid!,
      displayName,
      deviceType: platform.api.matter!.deviceTypes.ColorTemperatureLight,
      serialNumber,
      manufacturer: 'Clipsal',
      model: 'Switch',
      firmwareRevision: '1.0.0',
      hardwareRevision: '1.0.0',
      clusters: {
        onOff: {
          onOff: false,
        },
        levelControl: {
          currentLevel: 254,
          minLevel: 1,
          maxLevel: 254,
        },
        colorControl: {
          colorMode: platform.api.matter!.types.ColorControl.ColorMode.ColorTemperatureMireds,
          colorTemperatureMireds: 140,
          colorTempPhysicalMinMireds: 140,
          colorTempPhysicalMaxMireds: 500,
          coupleColorTempToLevelMinMireds: 140,
        },
      },
      handlers: {
        onOff: {
          on: async () => this.handleOnOff(true),
          off: async () => this.handleOnOff(false),
        },
        colorControl: {
          moveToColorTemperatureLogic: async (request) => this.handleSetColorTemperature(request),
        },
      },
    });

    if (existingAccessory) {
      this.deviceType = platform.api.matter!.deviceTypes.ExtendedColorLight;
      existingAccessory.handlers = {
        onOff: {
          on: async () => this.handleOnOff(true),
          off: async () => this.handleOnOff(false),
        },
        colorControl: {
          moveToColorTemperatureLogic: async (request) => this.handleSetColorTemperature(request),
        },
      };
      this.handlers = existingAccessory.handlers;
    }

    const type = this.platform.config.deviceTypes?.find(
      (v) => v.name === this.name,
    );
    this.sequence = type
      ? [type.defaultColor, type.secondColor, type.thirdColor]
      : ['cool_white', 'warm_white', 'day_white'];
    
    this.setMatrix();

    this.defaultColor = type?.defaultColor || 'cool_white';
    this.temperature = this.getTempFromColorName(this.defaultColor);
    this.temperatureReset = true;

    // Initialize state
    if (!existingAccessory) {
      const currentWiserLevel = 0;
      this.state = currentWiserLevel > 0;

      if (this.clusters) {
        if (this.clusters.onOff) {
          this.clusters.onOff.onOff = this.state;
        }
        if (this.clusters.colorControl) {
          this.clusters.colorControl.colorTemperatureMireds = this.temperature;
        }
      }
    } else {
      if (this.clusters) {
        if (this.clusters.onOff?.onOff !== undefined) {
          this.state = this.clusters.onOff.onOff;
        }
        if (this.clusters.colorControl?.colorTemperatureMireds !== undefined) {
          this.temperature = this.clusters.colorControl.colorTemperatureMireds;
        }
      }
    }
  }

  private setMatrix() {
    this.onOffMatrix = {
      warm_white: {
        cool_white: 2,
        warm_white: 0,
        day_white: 1,
      },
      day_white: {
        warm_white: 2,
        day_white: 0,
        cool_white: 1,
      },
      cool_white: {
        warm_white: 1,
        day_white: 2,
        cool_white: 0,
      },
    };
    for (let i = 0; i < this.sequence.length; i++) {
      this.onOffMatrix[this.sequence[i]] = {};
      for (let j = 0; j < this.sequence.length; j++) {
        this.onOffMatrix[this.sequence[i]][this.sequence[j]] =
          j - i < 0 ? j - i + this.sequence.length : j - i;
      }
    }
    this.logDebug(`OnOff matrix: ${JSON.stringify(this.onOffMatrix)}`);
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getColorNameFromColorTemp(temp: number) {
    if (temp < 172) {
      return 'cool_white';
    } else if (temp < 241) {
      return 'day_white';
    } else {
      return 'warm_white';
    }
  }

  private getTempFromColorName(color: string) {
    const values = { cool_white: 140, day_white: 240, warm_white: 400 };
    return values[color] || 140;
  }

  private getNextTemp(current: number) {
    const currentColor = this.getColorNameFromColorTemp(current);
    const nextColor =
      this.sequence[
        (this.sequence.indexOf(currentColor) + 1) % this.sequence.length
      ];
    return this.getTempFromColorName(nextColor);
  }

  protected async handleOnOff(value: boolean): Promise<void> {
    this.logDebug(`Set three-color light on/off to ${value}`);
    this.state = value;

    if (value) {
      this.temperature = this.temperatureReset
        ? this.temperature
        : this.getNextTemp(this.temperature);
      
      this.updateState('colorControl', { colorTemperatureMireds: this.temperature }).catch((err) => {
        this.logError('Failed to update color temperature state:', err);
      });

      if (this.resetTimeout) {
        clearTimeout(this.resetTimeout);
        this.resetTimeout = null;
      }
      this.temperatureReset = false;

      this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, 255);
    } else {
      this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, 0);

      this.resetTimeout = setTimeout(() => {
        this.temperature = this.getTempFromColorName(this.defaultColor);
        this.logDebug(`Resetting ${this.name} to default color: ${this.defaultColor}`);
        this.updateState('colorControl', { colorTemperatureMireds: this.temperature }).catch((err) => {
          this.logError('Failed to update default color temp state:', err);
        });
        this.temperatureReset = true;
      }, 10000);
    }

    this.updateState('onOff', { onOff: value }).catch((err) => {
      this.logError('Failed to update onOff state:', err);
    });
  }

  protected async handleSetColorTemperature(request: { colorTemperatureMireds: number, transitionTime: number }): Promise<void> {
    this.logDebug(`moveToColorTemperatureLogic request: ${JSON.stringify(request)}`);
    const targetMireds = request.colorTemperatureMireds;

    const times =
      this.onOffMatrix[this.getColorNameFromColorTemp(this.temperature)][
        this.getColorNameFromColorTemp(targetMireds)
      ] || 0;

    this.logDebug(`Toggling ${times} times to switch from ${this.getColorNameFromColorTemp(this.temperature)} to ${this.getColorNameFromColorTemp(targetMireds)}`);

    for (let i = 0; i < times; i++) {
      this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, 0);
      await this.sleep(1200);
      this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, 255);
      await this.sleep(1200);
    }

    this.temperature = targetMireds;
    this.updateState('colorControl', { colorTemperatureMireds: targetMireds }).catch((err) => {
      this.logError('Failed to update color temperature state:', err);
    });
  }

  setStatusFromEvent(groupSetEvent: GroupSetEvent): void {
    const isWiserOn = groupSetEvent.level > 0;
    this.state = isWiserOn;
    this.logDebug(`Update three-color light status: ${isWiserOn ? 'On' : 'Off'}`);

    this.updateState('onOff', { onOff: isWiserOn }).catch((err) => {
      this.logError('Failed to update state:', err);
    });

    this.updateState('colorControl', { colorTemperatureMireds: this.temperature }).catch((err) => {
      this.logError('Failed to update colorTemp state:', err);
    });
  }
}
