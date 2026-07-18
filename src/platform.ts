import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic, MatterAccessory } from 'homebridge';
import { GroupSetEvent, WiserDevice, WiserProjectGroup, DeviceType, AccessoryAddress } from './models';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { Wiser } from './wiser';
import { WiserAccessory } from './wiseraccessory';
import { WiserBulb } from './wiserbulb';
import { WiserFan } from './wiserfan';
import { WiserSwitch } from './wiserswitch';
import { WiserBlind } from './wiserblind';
import { WiserAC } from './wiserac';
import { WiserThreeColorLight } from './wiserthreecolorlight';
import {
    BaseMatterAccessory,
    WiserMatterSwitch,
    WiserMatterBulb,
    WiserMatterFan,
    WiserMatterBlind,
    WiserMatterAC,
    WiserMatterThreeColorLight,
} from './matter';

export class WiserPlatform implements DynamicPlatformPlugin {
    public readonly Service: typeof Service = this.api.hap.Service;
    public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

    // this is used to track restored cached accessories
    public readonly accessories: PlatformAccessory[] = [];

    private wiserAddress: string;
    private wiserPort: number;
    private username: string;
    private password: string;
    private wiser: Wiser;
    private wiserGroups: Record<number, WiserAccessory> = {};
    private ignoredAddresses: AccessoryAddress[] = [];

    private matterAccessoriesMap: Map<string, MatterAccessory> = new Map();
    private wiserMatterGroups: Record<number, BaseMatterAccessory> = {};

    private initialRetryDelay = 5000;
    private retryDelay = this.initialRetryDelay;

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        this.log.debug('Finished initializing platform:', this.config.name);

        this.wiserAddress = this.config.wiserAddress;
        this.wiserPort = this.config.wiserPort;
        this.username = this.config.wiserUsername;
        this.password = this.config.wiserPassword;

        if (undefined !== this.config.ignoredGAs) {
            for (const address of this.config.ignoredGAs) {
                const ignore = new AccessoryAddress(address.network, address.ga);
                this.log.debug(`Adding ${ignore} to ignore list`);
                this.ignoredAddresses.push(ignore);
            }
        }

        this.wiser = new Wiser(this.wiserAddress, this.wiserPort, this.username, this.password, this.config.deviceTypes, log);

        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            log.debug('Executed didFinishLaunching callback');
            this.log.debug(`[didFinishLaunching] isMatterEnabled: ${this.api.isMatterEnabled?.()}`);
            this.log.debug(`[didFinishLaunching] matterAccessoriesMap size: ${this.matterAccessoriesMap.size}`);

            if (this.api.isMatterEnabled?.()) {
                const restoredAccessories: MatterAccessory[] = [];
                for (const [uuid, cachedAccessory] of this.matterAccessoriesMap.entries()) {
                    if (cachedAccessory.context?.device) {
                        try {
                            const device = this.reconstructDeviceFromContext(cachedAccessory.context);
                            const wiserAccessory = this.createMatterAccessory(device, cachedAccessory);
                            this.wiserMatterGroups[device.id] = wiserAccessory;
                            restoredAccessories.push(wiserAccessory.toAccessory());
                        } catch (err) {
                            this.log.error(`Failed to reconstruct cached accessory ${cachedAccessory.displayName}:`, err);
                        }
                    }
                }
                if (restoredAccessories.length > 0) {
                    this.log.info(`Registering ${restoredAccessories.length} restored Matter accessories synchronously...`);
                    this.api.matter!.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, restoredAccessories)
                      .then(() => {
                          this.log.info('Successfully registered all restored Matter accessories. Starting Wiser...');
                          this.wiser.start();
                      })
                      .catch((err) => {
                          this.log.error('Failed to register restored Matter accessories:', err);
                          this.wiser.start();
                      });
                } else {
                    this.wiser.start();
                }
            } else {
                this.wiser.start();
            }

            this.wiser.on('retrievedProject', (projectGroups: WiserProjectGroup[]) => {
                const newMatterAccessories: MatterAccessory[] = [];
                for (const group of projectGroups) {
                    const ignored = this.isIgnored(group.address);
                    if (ignored) {
                        this.log.info(`Ignoring ${group.name}(${group.address})`);
                    } else {
                        this.addDevice(group, newMatterAccessories);
                    }
                }
                if (newMatterAccessories.length > 0) {
                    this.log.info(`Registering ${newMatterAccessories.length} new Matter accessories in a single batch...`);
                    this.api.matter!.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, newMatterAccessories)
                      .then(() => {
                          this.log.info('Successfully registered all new Matter accessories.');
                      })
                      .catch((err) => {
                          this.log.error('Failed to register Matter accessories:', err);
                      });
                }
                this.wiser.getLevels();
            });

            this.wiser.on('groupSet', (groupSetEvent: GroupSetEvent) => {
                this.setGroup(groupSetEvent);
            });

            this.wiser.on('groupSetScan', (groupSetEvent: GroupSetEvent) => {
                this.setGroup(groupSetEvent, false);
            });
        });
    }

    setGroup(groupSetEvent: GroupSetEvent, missingGroupIsError = true) {
        if (this.api.isMatterEnabled?.()) {
            const matterAccessory = this.wiserMatterGroups[groupSetEvent.groupAddress];
            if (undefined !== matterAccessory) {
                this.log.info(`Setting Matter ${matterAccessory.displayName}(${matterAccessory.id}) to ${groupSetEvent.level}`);
                matterAccessory.setStatusFromEvent(groupSetEvent);
            } else {
                if (missingGroupIsError) {
                    if (!this.isIgnored(new AccessoryAddress(254, groupSetEvent.groupAddress))) {
                        this.log.warn(`Could not find Matter accessory to handle event for ${groupSetEvent.groupAddress}`);
                    }
                }
            }
            return;
        }

        const accessory = this.wiserGroups[groupSetEvent.groupAddress];
        if (undefined !== accessory) {
            this.log.debug(`Setting ${accessory.name}(${accessory.id}) to ${groupSetEvent.level}`);
            accessory.setStatusFromEvent(groupSetEvent);
        } else {
            if (missingGroupIsError) {
                if (!this.isIgnored(new AccessoryAddress(254, groupSetEvent.groupAddress))) {
                    this.log.warn(`Could not find accessory to handle event for ${groupSetEvent.groupAddress}`);
                    this.log.warn(
                        `Consider adding \n{\n"network":254,\n"ga":${groupSetEvent.groupAddress}\n}\n to the "ignoredGAs" config`,
                    );
                }
            }
        }
    }

    /**
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory: PlatformAccessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);

        // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.accessories.push(accessory);
    }

    configureMatterAccessory(accessory: MatterAccessory) {
        this.log.info('Loading Matter accessory from cache:', accessory.displayName);
        this.matterAccessoriesMap.set(accessory.UUID, accessory);
    }

    addDevice(group: WiserProjectGroup, newMatterAccessories?: MatterAccessory[]) {
        const device = new WiserDevice(group.name, group.name, group.address.groupAddress, group, this.wiser);

        if (this.api.isMatterEnabled?.()) {
            this.addMatterDevice(device, newMatterAccessories);
            return;
        }

        if (undefined !== this.wiserGroups[device.id]) {
            this.log.warn(`Ignoring duplicate device for group address ${device.id}`);
            return;
        }

        this.log.debug(`Adding group ${device.id}`);

        const uuid = this.api.hap.uuid.generate(`${group.address.network}-${group.application}-${device.id}`);
        const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

        let wiserAccessory;

        if (existingAccessory) {
            // the accessory already exists
            this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
            existingAccessory.context.device = device;
            wiserAccessory = this.createAccessory(device, existingAccessory);
        } else {
            this.log.info('Adding new accessory:', device.displayName);
            const accessory = new this.api.platformAccessory(device.displayName, uuid);
            accessory.context.device = device;
            wiserAccessory = this.createAccessory(device, accessory);
            // link the accessory to your platform
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
        this.wiserGroups[device.id] = wiserAccessory;
    }

    addMatterDevice(device: WiserDevice, newMatterAccessories?: MatterAccessory[]) {
        if (undefined !== this.wiserMatterGroups[device.id]) {
            this.log.warn(`Ignoring duplicate Matter device for group address ${device.id}`);
            return;
        }

        this.log.debug(`Adding Matter group ${device.id}`);

        const uuid = this.api.matter!.uuid.generate(`${device.wiserProjectGroup.address.network}-${device.wiserProjectGroup.application}-${device.id}`);
        const existingAccessory = this.matterAccessoriesMap.get(uuid);

        let wiserAccessory: BaseMatterAccessory;

        if (existingAccessory) {
            this.log.info('Restoring existing Matter accessory from cache:', existingAccessory.displayName);
            existingAccessory.context.device = device;
            wiserAccessory = this.createMatterAccessory(device, existingAccessory);
        } else {
            this.log.info('Adding new Matter accessory:', device.displayName);
            wiserAccessory = this.createMatterAccessory(device, undefined, uuid);
        }

        if (newMatterAccessories) {
            newMatterAccessories.push(wiserAccessory.toAccessory());
        } else {
            this.api.matter!.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [wiserAccessory.toAccessory()]);
        }
        this.wiserMatterGroups[device.id] = wiserAccessory;
    }

    createAccessory(device: WiserDevice, accessory: PlatformAccessory): WiserAccessory {
        switch (device.wiserProjectGroup.deviceType) {
            case DeviceType.switch:
                return new WiserSwitch(this, accessory);
            case DeviceType.dimmer:
                return new WiserBulb(this, accessory);
            case DeviceType.fan:
                return new WiserFan(this, accessory);
            case DeviceType.blind:
                return new WiserBlind(this, accessory);
            case DeviceType.ac:
                return new WiserAC(this, accessory);
            case DeviceType.threeColorLight:
                return new WiserThreeColorLight(this, accessory);
            default:
                this.log.error(`Unknown device type ${device.wiserProjectGroup.deviceType}`);
                break;
        }
        return new WiserSwitch(this, accessory);
    }

    createMatterAccessory(device: WiserDevice, existingAccessory?: MatterAccessory, uuid?: string): BaseMatterAccessory {
        switch (device.wiserProjectGroup.deviceType) {
            case DeviceType.switch:
                return new WiserMatterSwitch(this, device, existingAccessory, uuid);
            case DeviceType.dimmer:
                return new WiserMatterBulb(this, device, existingAccessory, uuid);
            case DeviceType.fan:
                return new WiserMatterFan(this, device, existingAccessory, uuid);
            case DeviceType.blind:
                return new WiserMatterBlind(this, device, existingAccessory, uuid);
            case DeviceType.ac:
                return new WiserMatterAC(this, device, existingAccessory, uuid);
            case DeviceType.threeColorLight:
                return new WiserMatterThreeColorLight(this, device, existingAccessory, uuid);
            default:
                this.log.error(`Unknown device type ${device.wiserProjectGroup.deviceType}`);
                break;
        }
        return new WiserMatterSwitch(this, device, existingAccessory, uuid);
    }

    private reconstructDeviceFromContext(context: any): WiserDevice {
        const cachedDevice = context.device;
        const cachedGroup = cachedDevice.wiserProjectGroup;
        const address = new AccessoryAddress(cachedGroup.address.network, cachedGroup.address.groupAddress);
        const deviceTypeName = typeof cachedGroup.deviceType === 'string' ? cachedGroup.deviceType : (cachedGroup.deviceType?.name || 'switch');
        const deviceType = DeviceType.fromString(deviceTypeName);
        const group = new WiserProjectGroup(
            cachedGroup.name,
            address,
            deviceType,
            cachedGroup.fanSpeeds || [],
            cachedGroup.application,
            cachedGroup.dimmable,
            cachedGroup.ramprate
        );
        return new WiserDevice(cachedDevice.displayName, cachedDevice.name, cachedDevice.id, group, this.wiser);
    }

    private isIgnored(checkAddress: AccessoryAddress): boolean {
        let ignored = false;
        for (const address of this.ignoredAddresses) { // eslint-disable-next-line eqeqeq
            if (address.network == checkAddress.network && address.groupAddress == checkAddress.groupAddress) {
                ignored = true;
            }
        }
        return ignored;
    }
}