---
title: Settings: the config file and CONF
keywords: config, settings, setting, configuration, configuracion, ajustes, conf, option, options, port, secret, environment, env
strong: config, conf, configuration, settings
---
The settings of the application are in the file `config` in the root of the project, one per line, `key : value`:

```text
name                : My application
port      (Number)  : 8000
token               :
```

They are read with `CONF.name`, `CONF.port`. The settings of the framework start with `$` (`$ip`, `$port`). Do not use `process.env`, `dotenv` or `package.json` for settings.

The framework loads the native config file automatically. In definitions, actions and controllers, read the initialized CONF object directly:

```js
var name = CONF.name;
var port = CONF.port;
```

The config file is data in the native key : value format; CONF is already available in loaded application code.
