import fs from "fs";

export class Util {
	static getJson (path) {
		return JSON.parse(fs.readFileSync(path, "utf-8"));
	}

	static getDateString () {
		const date = new Date();
		return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
	}
}
