'use strict';
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { WiserPlatform } from './platform';
import { GroupSetEvent } from './models';
import { WiserSwitch } from './wiserswitch';

export class WiserThreeColorLight extends WiserSwitch {

    private temperature= 140;
    constructor(
        protected readonly platform: WiserPlatform,
        protected readonly accessory: PlatformAccessory,
    ) {

        super(platform, accessory);
    }

    fetName(): string {
        return (typeof this.accessory.context.device.name !== 'undefined') ? this.accessory.context.device.name :
            `Switch ${this.accessory.context.device.id}`;
    }

    setupService(): Service {
        const service = this.accessory.getService(this.platform.Service.Lightbulb) ||
            this.accessory.addService(this.platform.Service.Lightbulb);
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Clipsal')
            .setCharacteristic(this.platform.Characteristic.Model, 'Dimmer')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, `${this.accessory.context.device.id}`.padStart(4, '0'));

        service.setCharacteristic(this.platform.Characteristic.Name, this.name);

        service.getCharacteristic(this.platform.Characteristic.On)
            .onGet(this.getOn.bind(this))
            .onSet(this.setOn.bind(this));

        service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
            .onGet(this.getTemperature.bind(this))
            .onSet(this.setTemperature.bind(this));

        return service;
    }

    private func;
    async setOn(value: CharacteristicValue) {
        super.setOn(value);
        if (value as boolean) {
            try {
                clearTimeout(this.func);
            } catch (error) {
                this.platform.log.error(`${error}`);
            }
            this.temperature = this.getNextTemp(this.temperature);
        } else {
            this.func = setTimeout(() => {
                //Set to orange
                this.temperature = 140;
            }, 120000);
        }
    }

    async getTemperature(): Promise<CharacteristicValue> {
        return this.temperature;
    }

    private onOff = {
        'orange': {
            'orange': 0,
            'yellow': 1,
            'white': 2,
        },
        'yellow': {
            'orange': 2,
            'yellow': 0,
            'white': 1,
        },
        'white': {
            'orange': 1,
            'yellow': 2,
            'white': 0,
        },
    };

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getColorNameFromColorTemp(temp) {
        if (temp < 172) {
            return 'orange';
        } else if (temp < 303) {
            return 'yellow';
        } else {
            return 'white';
        }
    }

    async setTemperature(value: CharacteristicValue) {
        const times = this.onOff[this.getColorNameFromColorTemp(this.temperature)][this.getColorNameFromColorTemp(value as number)];
        for (let i = 0; i < times; i++) {
            this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, 0);
            await this.sleep(1200);
            this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, 255);
            await this.sleep(1200);
        }
        this.temperature = value as number;
        this.platform.log.debug(`Homekit set ${this.name} to ${this.level} (${this.toWiserLevel(this.level)})`);
    }

    getNextTemp(current) {
        return current < 172? 303: current < 303? 400: 140;
    }

    getName(): string {
        return (typeof this.accessory.context.device.name !== 'undefined') ? this.accessory.context.device.name :
            `Light ${this.accessory.context.device.id}`;
    }

    setStatusFromEvent(groupSetEvent: GroupSetEvent) {

        this.level =this.toHomeKitLevel(groupSetEvent.level);

        this.platform.log.debug(`Update light level ${this.level}`);
        this.updateOnState();
    }

    updateOnState() {
        this.service!.updateCharacteristic(this.platform.Characteristic.On, this.level > 0);
        this.service!.updateCharacteristic(this.platform.Characteristic.Brightness, this.level);
    }


}