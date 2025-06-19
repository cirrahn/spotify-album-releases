import {Util} from "./Util.js";

export class ConfigManager {
	static _CONFIG = null;

	static _getInitConfig () {
		const config = Util.getJson("./config.json");

		config.album_name_blocklist = (config.album_name_blocklist || [])
			.map(([raw, flags]) => new RegExp(raw, flags || ""));

		return config;
	}

	static validateConfig (props) {
		props
			.forEach(prop => {
				if (!this.CONFIG[prop]) throw new Error(`Config property "${prop}" is required!`);
			});
	}

	static get CONFIG () {
		return (this._CONFIG ||= this._getInitConfig());
	}
}
