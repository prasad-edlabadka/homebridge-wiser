'use strict';

'use strict';
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { WiserPlatform } from './platform';
import { GroupSetEvent } from './models';
import { WiserAccessory } from './wiseraccessory';

export class WiserAC extends WiserAccessory {

    protected level = 0;
    protected previousLevel = 100;
    protected temperature = 16;
    protected state;
    protected fan = 0;
    protected swing = 0;

    constructor(
        protected readonly platform: WiserPlatform,
        protected readonly accessory: PlatformAccessory,
    ) {

        super(platform, accessory);
    }

    getName(): string {
        return (typeof this.accessory.context.device.name !== 'undefined') ? this.accessory.context.device.name :
            `Switch ${this.accessory.context.device.id}`;
    }

    setupService(): Service {
        const service = this.accessory.getService(this.platform.Service.HeaterCooler) ||
            this.accessory.addService(this.platform.Service.HeaterCooler);
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Mitsubishi Electric')
            .setCharacteristic(this.platform.Characteristic.Model, 'Wide & Long')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, `${this.accessory.context.device.id}`.padStart(4, '0'));

        service.setCharacteristic(this.platform.Characteristic.Name, this.name);

        service.getCharacteristic(this.platform.Characteristic.Active)
            .onGet(this.getOn.bind(this))
            .onSet(this.setOn.bind(this));

        service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
            .setProps({
                minValue: 16,
                maxValue: 28,
                minStep: 2,
            })
            .onGet(this.getCoolingThresholdTemperatureCharacteristic.bind(this))
            .onSet(this.setCoolingThresholdTemperatureCharacteristic.bind(this));

        service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
            .setProps({
                validValues: [
                    this.platform.Characteristic.TargetHeaterCoolerState.COOL,
                ],
            })
            .onGet(this.getTargetHeaterCoolerStateCharacteristic.bind(this))
            .onSet(this.setTargetHeaterCoolerStateCharacteristic.bind(this));

        service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.getCurrentTemperature.bind(this));

        service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
            .setProps({
                unit: undefined,
                minValue: 0,
                maxValue: 3,
                minStep: 1,
            })
            .onGet(this.getRotationSpeedCharacteristic.bind(this))
            .onSet(this.setRotationSpeedCharacteristic.bind(this));

        service.getCharacteristic(this.platform.Characteristic.SwingMode)
            .onGet(this.getSwingModeCharacteristic.bind(this))
            .onSet(this.setSwingModeCharacteristic.bind(this));

        return service;
    }

    async getOn(): Promise<CharacteristicValue> {
        this.platform.log.debug(`Get on state ${this.name}(${this.id}) ${this.level === 12}`);
        return this.level === 12;
    }

    async setOn(value: CharacteristicValue) {
        const newState = `${value}` === '1';
        const targetLevel = newState ? 12 : 10;
        this.previousLevel = this.level;
        this.platform.log.debug(`${this.name} set on/off ${newState} target level ${targetLevel}`);
        this.level = targetLevel;
        this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, targetLevel);
    }

    setStatusFromEvent(groupSetEvent: GroupSetEvent) {
        this.level = groupSetEvent.level;
        this.platform.log.debug(`Update AC Status to ${this.level}`);
        this.updateOnState();
    }

    updateOnState() {
        this.service!.updateCharacteristic(this.platform.Characteristic.On, this.level === 12);
    }

    getCoolingThresholdTemperatureCharacteristic(): CharacteristicValue {
        return this.temperature;
    }

    private temperatureConverstion = {
        '16': 15, '18': 17, '20': 20, '22': 22, '24': 25, '26': 28, '28': 30,
    };

    setCoolingThresholdTemperatureCharacteristic(value: CharacteristicValue) {
        let level = 10;
        this.temperature = value as number;
        level = this.temperatureConverstion[`${this.temperature}`];
        this.platform.log.debug(`Set AC temperature to ${this.temperature} level ${level}`);
        this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, level);
    }

    setTargetHeaterCoolerStateCharacteristic(value: CharacteristicValue) {
        this.platform.log.debug(`Set AC state to ${value}`);
        this.state = value;
        if (value === this.platform.Characteristic.TargetHeaterCoolerState.COOL) {
            this.temperature = 22;
        } else {
            this.temperature = 16;
        }
        this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, this.temperature);
    }

    getTargetHeaterCoolerStateCharacteristic(): CharacteristicValue {
        return this.platform.Characteristic.TargetHeaterCoolerState.COOL;
    }

    getCurrentTemperature(): CharacteristicValue {
        return this.temperature;
    }

    getRotationSpeedCharacteristic(): CharacteristicValue {
        return this.fan;
    }

    private fanConverstion = {
        '1': 2, '2': 5, '0': 7,
    };

    setRotationSpeedCharacteristic(value: CharacteristicValue) {
        this.fan = value as number;
        const level = this.fanConverstion[`${this.fan}`] || 7;
        this.platform.log.debug(`Set AC fan to ${this.fan} level ${level}`);
        this.wiser.setGroupLevel(this.device.wiserProjectGroup.address, this.fan);
    }

    getSwingModeCharacteristic(): CharacteristicValue {
        return this.swing;
    }

    setSwingModeCharacteristic(value: CharacteristicValue) {
        this.swing = value as number;
        this.wiser.setGroupLevel(
            this.device.wiserProjectGroup.address, value === this.platform.Characteristic.SwingMode.SWING_ENABLED ? 40 : 38);
    }
}
