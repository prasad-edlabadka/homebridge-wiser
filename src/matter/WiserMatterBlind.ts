import { BaseMatterAccessory } from './BaseMatterAccessory';
import { WiserPlatform } from '../platform';
import { WiserDevice, GroupSetEvent } from '../models';
import type { MatterAccessory, MatterRequests } from 'homebridge';

export class WiserMatterBlind extends BaseMatterAccessory {
  protected targetPosition = 0;
  protected currentPosition = 0;

  constructor(
    platform: WiserPlatform,
    device: WiserDevice,
    existingAccessory?: MatterAccessory,
    uuid?: string,
  ) {
    const displayName = typeof device.name !== 'undefined' ? device.name : `Blind ${device.id}`;
    const serialNumber = `${device.id}`.padStart(4, '0');

    super(platform, device, existingAccessory || {
      UUID: uuid!,
      displayName,
      deviceType: platform.api.matter!.deviceTypes.WindowCovering,
      serialNumber,
      manufacturer: 'Clipsal',
      model: 'Blind',
      firmwareRevision: '1.0.0',
      hardwareRevision: '1.0.0',
      clusters: {
        windowCovering: {
          targetPositionLiftPercent100ths: 10000,
          currentPositionLiftPercent100ths: 10000,
          operationalStatus: {
            global: 0,
            lift: 0,
            tilt: 0,
          },
          endProductType: 0,
          configStatus: {
            operational: true,
            onlineReserved: true,
            liftMovementReversed: false,
            liftPositionAware: true,
            tiltPositionAware: false,
            liftEncoderControlled: true,
            tiltEncoderControlled: false,
          },
        },
      },
      handlers: {
        windowCovering: {
          goToLiftPercentage: async (request) => this.handleGoToLift(request),
          upOrOpen: async () => this.handleUpOrOpen(),
          downOrClose: async () => this.handleDownOrClose(),
          stopMotion: async () => this.handleStop(),
        },
      },
    });

    if (existingAccessory) {
      this.deviceType = platform.api.matter!.deviceTypes.WindowCovering;
      existingAccessory.handlers = {
        windowCovering: {
          goToLiftPercentage: async (request) => this.handleGoToLift(request),
          upOrOpen: async () => this.handleUpOrOpen(),
          downOrClose: async () => this.handleDownOrClose(),
          stopMotion: async () => this.handleStop(),
        },
      };
      this.handlers = existingAccessory.handlers;
    }

    // Initialize state
    if (!existingAccessory) {
      const currentWiserLevel = 0;
      this.currentPosition = this.toHomeKitLevel(currentWiserLevel);
      this.targetPosition = this.currentPosition;

      if (this.clusters && this.clusters.windowCovering) {
        const closedPercent = 100 - this.currentPosition;
        const val = Math.round(closedPercent * 100);
        this.clusters.windowCovering.currentPositionLiftPercent100ths = val;
        this.clusters.windowCovering.targetPositionLiftPercent100ths = val;
      }
    } else {
      if (this.clusters && this.clusters.windowCovering?.currentPositionLiftPercent100ths !== undefined && this.clusters.windowCovering.currentPositionLiftPercent100ths !== null) {
        const closedPercent = this.clusters.windowCovering.currentPositionLiftPercent100ths / 100;
        this.currentPosition = Math.round(100 - closedPercent);
        this.targetPosition = this.currentPosition;
      }
    }
  }

  protected async handleGoToLift(request: MatterRequests.GoToLiftPercentage): Promise<void> {
    this.logDebug(`GoToLiftPercentage request: ${JSON.stringify(request)}`);
    const closedPercent = request.liftPercent100thsValue / 100;
    const openPercent = Math.round(100 - closedPercent);

    this.targetPosition = openPercent;

    this.wiser.setGroupLevel(
      this.device.wiserProjectGroup.address,
      this.toWiserLevel(openPercent),
    );

    const val = Math.round(closedPercent * 100);
    this.updateState('windowCovering', {
      targetPositionLiftPercent100ths: val,
    }).catch((err) => {
      this.logError('Failed to update window covering target position state:', err);
    });
  }

  protected async handleUpOrOpen(): Promise<void> {
    this.logDebug('handleUpOrOpen request');
    this.targetPosition = 100;
    this.wiser.setGroupLevel(
      this.device.wiserProjectGroup.address,
      this.toWiserLevel(100),
    );
    this.updateState('windowCovering', {
      targetPositionLiftPercent100ths: 0,
    }).catch((err) => {
      this.logError('Failed to update window covering state:', err);
    });
  }

  protected async handleDownOrClose(): Promise<void> {
    this.logDebug('handleDownOrClose request');
    this.targetPosition = 0;
    this.wiser.setGroupLevel(
      this.device.wiserProjectGroup.address,
      this.toWiserLevel(0),
    );
    this.updateState('windowCovering', {
      targetPositionLiftPercent100ths: 10000,
    }).catch((err) => {
      this.logError('Failed to update window covering state:', err);
    });
  }

  protected async handleStop(): Promise<void> {
    this.logDebug('handleStop request');
    this.targetPosition = this.currentPosition;
    this.wiser.setGroupLevel(
      this.device.wiserProjectGroup.address,
      this.toWiserLevel(this.currentPosition),
    );
    const closedPercent = 100 - this.currentPosition;
    const val = Math.round(closedPercent * 100);
    this.updateState('windowCovering', {
      targetPositionLiftPercent100ths: val,
    }).catch((err) => {
      this.logError('Failed to update window covering state:', err);
    });
  }

  setStatusFromEvent(groupSetEvent: GroupSetEvent): void {
    this.currentPosition = this.toHomeKitLevel(groupSetEvent.level);
    this.targetPosition = this.currentPosition;
    this.logDebug(`Update blind position to ${this.currentPosition}% open`);

    const closedPercent = 100 - this.currentPosition;
    const val = Math.round(closedPercent * 100);

    this.updateState('windowCovering', {
      currentPositionLiftPercent100ths: val,
      targetPositionLiftPercent100ths: val,
    }).catch((err) => {
      this.logError('Failed to update window covering state:', err);
    });
  }
}
