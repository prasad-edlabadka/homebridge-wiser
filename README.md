homebridge-wiser
================

homebridge-wiser is a plug-in for [Homebridge](https://github.com/homebridge/homebridge)
that adds support for the original Clipsal C-Bus Wiser and the Clipsal Wiser 2. This is a fork of version 2.0 of the plugin from [Paul Wilkinson](https://github.com/paulw11/homebridge-wiser). 

Accessories are automatically discovered from the Wiser project.  To add
additional accessories, add them to your Wiser project and restart homebridge.

Installation
------------

You can install the plug-in using `npm`:

`sudo npm install -g @prasad-edlabadkar/homebridge-wiser`

Additional Features
--------------

On top of features supported by the base plugin, following features are added.

* Support for IR controlled AC connected with Wiser 2.
* Support for 3 coloured lights that change color when switched off and on quickly.
* Ability to override device type in configuration depending on what is connected to your Wiser product.
* Light bulb will show sliding control only if it's connected to a dimmer.

Configuration
-------------

### Homebridge Configuration UI
You can configure the plugin using Homebridge configuration UI which will guide you on all aspects.

### Manually configuring config.json
*homebridge-wiser* is added as a `platform` in your config.json:

```JSON
"platforms": [
  {
  "platform": "homebridge-wiser",
  "name": "Wiser",
  "wiserAddress": "1.2.3.4",
  "wiserUsername": "admin",
  "wiserPassword": "yourpassword",
  "wiserPort": "8888",
  "ignoredGAs": [{
                    "network": 254,
                    "ga": 4
                },
                {
                    "network": 254,
                    "ga": 5
                }],
  "deviceTypes": [{
                    "name": "My light",
                    "type": "threeColorLight",
                    "defaultColor": "cool_white",
                    "secondColor": "warm_white",
                    "thirdColor": "day_white"
                },
                {
                    "name": "Guest Fan",
                    "type": "fan"
                },
                {
                    "name": "Dining On Off",
                    "type": "ac"
                }]
    }
]
```

The `ignoredGAs` section is optional.  If a group address is listed in this section, an accessory will not be created
even if it is found in your Wiser project.

The `deviceType` section is optional. The plugin will use device type of each C-bus device connected for creating a homekit device.

After adding the platform, simply restart homebridge and your C-Bus groups will
be added as new accessories automatically.

**Note**: `wiserPort` is *not* the web server port on your wiser (80).  Unless you have changed your Wiser from the default settings,
`8888` is the correct value.

Credits
-------

Thanks to [Paul Wilkinson](https://github.com/paulw11) for this wonderful plugin to enable a legacy product on homekit.
