import type { API, ClusterStateMap, EndpointType, Logger, MatterAccessory, MatterAPI } from 'homebridge';
import { WiserPlatform } from '../platform';
import { WiserDevice, GroupSetEvent } from '../models';
import { Wiser } from '../wiser';

export interface BaseMatterAccessoryConfig {
  UUID: string;
  displayName: string;
  deviceType: EndpointType;
  serialNumber: string;
  manufacturer: string;
  model: string;
  firmwareRevision: string;
  hardwareRevision: string;
  context?: Record<string, unknown>;
  clusters?: MatterAccessory['clusters'];
  handlers?: MatterAccessory['handlers'];
  parts?: MatterAccessory['parts'];
}

export abstract class BaseMatterAccessory implements MatterAccessory {
  public readonly UUID: string;
  public readonly displayName: string;
  public deviceType: EndpointType;
  public readonly serialNumber: string;
  public readonly manufacturer: string;
  public readonly model: string;
  public readonly firmwareRevision: string;
  public readonly hardwareRevision: string;
  public readonly context: Record<string, unknown>;
  public readonly clusters?: MatterAccessory['clusters'];
  public handlers?: MatterAccessory['handlers'];
  public readonly parts?: MatterAccessory['parts'];

  protected readonly platform: WiserPlatform;
  protected readonly log: Logger;
  protected readonly matter: MatterAPI;
  protected wiser: Wiser;
  protected device: WiserDevice;
  public readonly id: number;
  public readonly name: string;

  protected constructor(
    platform: WiserPlatform,
    device: WiserDevice,
    config: BaseMatterAccessoryConfig | MatterAccessory,
  ) {
    this.platform = platform;
    this.log = platform.log;
    this.wiser = device.wiser;
    this.device = device;
    this.id = device.id;
    this.name = config.displayName;

    if (!platform.api.matter) {
      throw new Error('Matter API is not available.');
    }
    this.matter = platform.api.matter;

    this.UUID = config.UUID;
    this.displayName = config.displayName;
    this.deviceType = config.deviceType;
    this.serialNumber = config.serialNumber || `${device.id}`.padStart(4, '0');
    this.manufacturer = config.manufacturer || 'Clipsal';
    this.model = config.model || 'Switch';
    this.firmwareRevision = config.firmwareRevision || '1.0.0';
    this.hardwareRevision = config.hardwareRevision || '1.0.0';
    this.clusters = config.clusters;
    this.handlers = config.handlers;
    this.parts = config.parts;

    this.context = {
      serialNumber: this.serialNumber,
      manufacturer: this.manufacturer,
      model: this.model,
      firmwareRevision: this.firmwareRevision,
      hardwareRevision: this.hardwareRevision,
      ...config.context,
    };
  }

  protected async updateState<K extends keyof ClusterStateMap>(cluster: K, attributes: Partial<ClusterStateMap[K]>, partId?: string): Promise<void>
  protected async updateState(cluster: string, attributes: Record<string, unknown>, partId?: string): Promise<void>
  protected async updateState(cluster: string, attributes: Record<string, unknown>, partId?: string): Promise<void> {
    await this.matter.updateAccessoryState(this.UUID, cluster, attributes, partId);
    this.log.debug(`[${this.displayName}] Updated ${cluster} state:`, attributes);
  }

  protected async readState<K extends keyof ClusterStateMap>(cluster: K, partId?: string): Promise<Partial<ClusterStateMap[K]> | undefined>
  protected async readState(cluster: string, partId?: string): Promise<Record<string, unknown> | undefined>
  protected async readState(cluster: string, partId?: string): Promise<Record<string, unknown> | undefined> {
    return await this.matter.getAccessoryState(this.UUID, cluster, partId);
  }

  protected logInfo(message: string, ...args: unknown[]): void {
    this.log.info(`[${this.displayName}] ${message}`, ...args);
  }

  protected logError(message: string, ...args: unknown[]): void {
    this.log.error(`[${this.displayName}] ${message}`, ...args);
  }

  protected logDebug(message: string, ...args: unknown[]): void {
    this.log.debug(`[${this.displayName}] ${message}`, ...args);
  }

  protected logWarn(message: string, ...args: unknown[]): void {
    this.log.warn(`[${this.displayName}] ${message}`, ...args);
  }

  public toAccessory(): MatterAccessory {
    return {
      UUID: this.UUID,
      displayName: this.displayName,
      deviceType: this.deviceType,
      serialNumber: this.serialNumber,
      manufacturer: this.manufacturer,
      model: this.model,
      firmwareRevision: this.firmwareRevision,
      hardwareRevision: this.hardwareRevision,
      context: this.context,
      clusters: this.clusters,
      handlers: this.handlers,
      parts: this.parts,
    };
  }

  abstract setStatusFromEvent(groupSetEvent: GroupSetEvent): void;

  protected toWiserLevel(level: number): number {
    return Math.round(level * 255 / 100);
  }

  protected toHomeKitLevel(wiserLevel: number): number {
    return Math.round(wiserLevel / 255 * 100);
  }
}
