'use strict';
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { WiserPlatform } from './platform';
import { GroupSetEvent } from './models';
import { WiserSwitch } from './wiserswitch';

export class WiserThreeColorLight extends WiserSwitch {

    private temperature = 140;
    private defaultColor = 'warm_white';
    private sequence = ['warm_white', 'day_white', 'cool_white'];
    private state = false;
    private onOff = {
    };

    constructor(
        protected readonly platform: WiserPlatform,
        protected readonly accessory: PlatformAccessory,
    ) {

        super(platform, accessory);
        const type = this.platform.config.deviceTypes.find(v => v.name === this.name);
        this.sequence = type ? [type.defaultColor, type.secondColor, type.thirdColor] : ['warm_white', 'day_white', 'cool_white'];
        this.setMatrix();
        this.defaultColor = this.getPreviousTemp(this.platform.config.deviceTypes.find(
            (v: { name: string }) => v.name === this.name)?.defaultColor || 'warm_white');
        this.temperature = this.getTempFromColorName(this.defaultColor);
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
            .setProps({
                minValue: 140,
                maxValue: 500,
                minStep: 1,
            })
            .onGet(this.getTemperature.bind(this))
            .onSet(this.setTemperature.bind(this));

        this.platform.log.debug(`Setting default color for ${this.name} to ${this.defaultColor} (${this.temperature})`);

        return service;
    }

    private func;
    async setOn(value: CharacteristicValue) {
        super.setOn(value);
        this.state = value as boolean;
        if (value as boolean) {
            try {
                clearTimeout(this.func);
            } catch (error) {
                this.platform.log.error(`${error}`);
            }
            this.temperature = this.getNextTemp(this.temperature);
            this.service!.updateCharacteristic(this.platform.Characteristic.ColorTemperature, this.temperature);
        } else {
            this.func = setTimeout(() => {
                //Set to default
                this.temperature = this.getTempFromColorName(this.defaultColor);
            }, 10000);
        }
    }

    async getTemperature(): Promise<CharacteristicValue> {
        return this.temperature;
    }

    private setMatrix() {
        this.onOff = {
            'warm_white': {
                'warm_white': 0,
                'day_white': 1,
                'cool_white': 2,
            },
            'day_white': {
                'warm_white': 2,
                'day_white': 0,
                'cool_white': 1,
            },
            'cool_white': {
                'warm_white': 1,
                'day_white': 2,
                'cool_white': 0,
            },
        };
        for (let i = 0; i < this.sequence.length; i++) {
            this.onOff[this.sequence[i]] = {};

            for (let j = 0; j < this.sequence.length; j++) {
                this.onOff[this.sequence[i]][this.sequence[j]] = (j - i) < 0 ? (j - i + this.sequence.length) : (j - i);
            }
        }
    }

    getPreviousTemp(current) {
        //const sequence = ['warm_white', 'day_white', 'cool_white'];
        const index = this.sequence.indexOf(current);
        return this.sequence[index - 1] || this.sequence[this.sequence.length - 1];
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getColorNameFromColorTemp(temp) {
        if (temp < 172) {
            return 'cool_white';
        } else if (temp < 225) {
            return 'day_white';
        } else {
            return 'warm_white';
        }
    }

    getTempFromColorName(color) {
        if (color === 'cool_white') {
            return 140;
        } else if (color === 'day_white') {
            return 222;
        } else {
            return 400;
        }
    }

    async setTemperature(value: CharacteristicValue) {
        const times = this.onOff[this.getColorNameFromColorTemp(this.temperature)][this.getColorNameFromColorTemp(value as number)];
        this.platform.log.warn(JSON.stringify(this.onOff));
        for (let i = 0; i < times; i++) {
            this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, 0);
            await this.sleep(1200);
            this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, 255);
            await this.sleep(1200);
        }
        this.platform.log.debug(
            `Setting ${this.name} from ${this.getColorNameFromColorTemp(this.temperature)}(${this.temperature})` +
            ` to ${this.getColorNameFromColorTemp(value as number)}(${value})`);
        this.temperature = value as number;
    }

    getNextTemp(current) {
        const currentColor = this.getColorNameFromColorTemp(current);
        const nextColor = this.sequence[(this.sequence.indexOf(currentColor) + 1) % this.sequence.length];
        return this.getTempFromColorName(nextColor);
    }

    getName(): string {
        return (typeof this.accessory.context.device.name !== 'undefined') ? this.accessory.context.device.name :
            `Light ${this.accessory.context.device.id}`;
    }

    setStatusFromEvent(groupSetEvent: GroupSetEvent) {

        this.level = this.toHomeKitLevel(groupSetEvent.level);

        this.platform.log.debug(`Update light level ${this.level}`);
        this.updateOnState();
    }

    updateOnState() {
        this.service!.updateCharacteristic(this.platform.Characteristic.On, this.state);
        this.service!.updateCharacteristic(this.platform.Characteristic.ColorTemperature, this.temperature);
        //this.service!.updateCharacteristic(this.platform.Characteristic.Brightness, this.level);
    }


}