import SpotifyWebApi from 'spotify-web-api-node';
import express from "express";
import opn from "opn";
import {Const} from "./Const.js";
import {Util} from "./Util.js";
import {SpotifyInterface} from "./SpotifyInterface.js";

/** Run a tiny express server to accept callback redirects. */
class ExpressWrapper {
	static pInit () {
		const app = express()

		app.get('/api/provide-token', (req, res) => {
			const code = req.query.code;
			if (!code) throw new Error("No code!");
			ExpressWrapper._RESOLVE_CODE(code);
			// TODO rework
			res.send(`<body style="width: 100vw; height: 100vh; background: black; color: #20c20e; font-family: monospace; display: flex; align-items: center; justify-content: center;"><div>ty for the code</div><script>setTimeout(() => window.close(), 1)</script></body>`);
		})

		return new Promise(resolve => {
			app.listen(Const.PORT_CALLBACK, () => {
				console.log(`Listening at ${Const.HOST_CALLBACK}:${Const.PORT_CALLBACK}`);
				resolve();
			});
		})
	}

	static async pGetSpotifyApi () {
		const creds = Util.getJson("./credentials.json");
		if (!creds.client_id || !creds.client_secret) throw new Error(`Credentials missing!`);

		const config = Util.getJson("./config.json");
		if (!config.user_id || !config.release_radar_playlist_id) throw new Error(`Config missing!`);

		const spotifyApi = new SpotifyWebApi({
			clientId: creds.client_id,
			clientSecret: creds.client_secret,
			redirectUri: `${Const.HOST_CALLBACK}:${Const.PORT_CALLBACK}${Const.ENDPOINT_CALLBACK}`,
		});

		const authorizeURL = await spotifyApi.createAuthorizeURL(Const.ALL_SCOPES);
		opn(authorizeURL, {app: 'chrome'});
		console.log(authorizeURL);

		const code = await ExpressWrapper.PROMISE_CODE;
		const authData = await spotifyApi.authorizationCodeGrant(code);
		spotifyApi.setAccessToken(authData.body['access_token']);
		spotifyApi.setRefreshToken(authData.body['refresh_token']);

		// region Client credentials version--does not allow user stuff
		// const data = await spotifyApi.clientCredentialsGrant();
		// spotifyApi.setAccessToken(data.body['access_token']);
		// endregion

		return {spotifyApi, config};
	}
}

ExpressWrapper.PROMISE_CODE = new Promise(resolve => {
	ExpressWrapper._RESOLVE_CODE = resolve;
});

class Main {
	static async run () {
		await ExpressWrapper.pInit();

		const {spotifyApi, config} = await ExpressWrapper.pGetSpotifyApi();
		await SpotifyInterface.pCreateReleaseRadarPlaylist({
			spotifyApi,
			releaseRadarPlaylistId: config.release_radar_playlist_id,
			userId: config.user_id,
		});
	}
}

Main.run()
	.catch(e => {
		throw e;
	})
	.then(() => {
		console.log("Done!");
		process.exit(0); // Force exit to kill the Express server
	});

