'use strict';

import { Wiser } from './wiser';

export class GroupSetEvent {
    constructor(
        public groupAddress: number,
        public level: number,
    ) { }
}

export class DeviceType {
    static switch = new DeviceType('switch');
    static dimmer = new DeviceType('dimmer');
    static fan = new DeviceType('fan');
    static blind = new DeviceType('blind');
    static ac = new DeviceType('ac');
    static threeColorLight = new DeviceType('threeColorLight');

    constructor(public name: string) {
    }

    static fromString(name: string): DeviceType {
        switch (name) {
            case 'switch':
                return DeviceType.switch;
            case 'dimmer':
                return DeviceType.dimmer;
            case 'fan':
                return DeviceType.fan;
            case 'blind':
                return DeviceType.blind;
            case 'ac':
                return DeviceType.ac;
            case 'threeColorLight':
                return DeviceType.threeColorLight;
            default:
                throw new Error(`Unknown device type ${name}`);
        }
    }

    toString() {
        return `${this.name}`;
    }
}

export class WiserProjectGroup {

    constructor(
        public name: string,
        public address: AccessoryAddress,
        public deviceType: DeviceType,
        public fanSpeeds: number[],
        public application,
    ) { }
}

export class WiserDevice {
    constructor(
        public displayName: string,
        public name: string,
        public id: number,
        public wiserProjectGroup: WiserProjectGroup,
        public wiser: Wiser,
    ) { }
}

export class AccessoryAddress {
    constructor(
        public readonly network: number,
        public readonly groupAddress: number,
    ) { }

    toString() {
        return `${this.network}:${this.groupAddress}`;
    }
}